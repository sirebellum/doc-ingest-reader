import React from 'react';
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { Block } from "../../../rust_core/contracts/bindings/Block"; export type { Block } from "../../../rust_core/contracts/bindings/Block";
import type { Annotation } from "../../../rust_core/contracts/bindings/Annotation"; export type { Annotation } from "../../../rust_core/contracts/bindings/Annotation";
import type { ASTNode } from '../../../rust_core/contracts/bindings/ASTNode';



export interface BlockCellProps {
  block: Block;
  annotations?: Annotation[];
  onPressBlock?: (block: Block, annotations: Annotation[]) => void;
  theme?: {
    textColor: string;
    headingColor: string;
    backgroundColor: string;
    borderColor: string;
    blockquoteBackground: string;
    accentColor: string;
    thBackground: string;
  };
  typography?: {
    fontSize: number;
    fontFamily: string;
    lineHeightMultiplier: number;
  };
}

interface HighlightSegment {
  text: string;
  isHighlighted: boolean;
  color?: string;
  annotation?: Annotation;
}

/**
 * Computes text highlights segments for native inline highlight wrapping.
 */
function getHighlightSegments(text: string, annotations: Annotation[]): HighlightSegment[] {
  if (!text || annotations.length === 0) {
    return [{ text, isHighlighted: false }];
  }
  
  interface Match {
    start: number;
    end: number;
    color: string;
    annotation: Annotation;
  }
  const matches: Match[] = [];
  
  for (const ann of annotations) {
    if (!ann.highlighted_text) continue;
    let index = text.indexOf(ann.highlighted_text);
    while (index !== -1) {
      matches.push({
        start: index,
        end: index + ann.highlighted_text.length,
        color: ann.color_code || 'hsl(48, 100%, 65%)',
        annotation: ann,
      });
      index = text.indexOf(ann.highlighted_text, index + 1);
    }
  }
  
  if (matches.length === 0) {
    return [{ text, isHighlighted: false }];
  }
  
  matches.sort((a, b) => a.start - b.start);
  
  const mergedMatches: Match[] = [];
  for (const match of matches) {
    if (mergedMatches.length === 0) {
      mergedMatches.push(match);
    } else {
      const last = mergedMatches[mergedMatches.length - 1];
      if (match.start < last.end) {
        if (match.end > last.end) {
          last.end = match.end;
        }
      } else {
        mergedMatches.push(match);
      }
    }
  }
  
  const segments: HighlightSegment[] = [];
  let lastIdx = 0;
  for (const match of mergedMatches) {
    if (match.start > lastIdx) {
      segments.push({
        text: text.substring(lastIdx, match.start),
        isHighlighted: false,
      });
    }
    segments.push({
      text: text.substring(match.start, match.end),
      isHighlighted: true,
      color: match.color,
      annotation: match.annotation,
    });
    lastIdx = match.end;
  }
  
  if (lastIdx < text.length) {
    segments.push({
      text: text.substring(lastIdx),
      isHighlighted: false,
    });
  }
  
  return segments;
}

/**
 * Premium native BlockCell component that recursively parses and renders ASTNode structures.
 * Supports text highlights, tables, images, codeblocks, and quotes with pure styling.
 */
export function BlockCell({ block, annotations = [], onPressBlock, theme, typography }: BlockCellProps) {
  // Extract theme and typography styles
  const textColor = theme?.textColor || 'hsl(0, 0%, 90%)';
  const headingColor = theme?.headingColor || 'hsl(210, 100%, 75%)';
  const accentColor = theme?.accentColor || 'hsl(210, 100%, 75%)';
  const blockquoteBackground = theme?.blockquoteBackground || 'hsl(220, 12%, 14%)';
  const borderColor = theme?.borderColor || 'hsl(220, 12%, 24%)';
  const thBackground = theme?.thBackground || 'hsl(220, 12%, 18%)';
  const backgroundColor = theme?.backgroundColor || 'hsl(220, 15%, 8%)';

  const baseFontSize = typography?.fontSize || 16;
  const fontFamily = typography?.fontFamily || 'System';
  const lineMultiplier = typography?.lineHeightMultiplier || 1.5;
  const baseLineHeight = baseFontSize * lineMultiplier;

  // Try parsing block content as JSON AST, fallback to a paragraph containing the raw content string
  let ast: ASTNode;
  try {
    ast = JSON.parse(block.content) as ASTNode;
  } catch (e) {
    ast = {
      type: 'paragraph',
      children: [{
        type: 'text',
        text: block.content,
        bold: null,
        italic: null,
        code: null
      }]
    };
  }

  // Recursive AST node rendering function
  const renderAST = (node: ASTNode, key: string | number): React.ReactNode => {
    if (!node) return null;

    switch (node.type) {
      case 'heading': {
        const headingSizeMultiplier = node.level === 1 ? 1.6 : node.level === 2 ? 1.4 : 1.2;
        return (
          <View key={key} style={styles.headingContainer}>
            <Text style={[styles.headingText, {
              color: headingColor,
              fontFamily,
              fontSize: baseFontSize * headingSizeMultiplier,
              lineHeight: baseFontSize * headingSizeMultiplier * 1.3,
            }]}>
              {node.children.map((child, idx) => renderAST(child, `h-child-${idx}`))}
            </Text>
          </View>
        );
      }

      case 'paragraph': {
        return (
          <Text key={key} style={[styles.paragraphText, {
            color: textColor,
            fontFamily,
            fontSize: baseFontSize,
            lineHeight: baseLineHeight,
          }]}>
            {node.children.map((child, idx) => renderAST(child, `p-child-${idx}`))}
          </Text>
        );
      }

      case 'text': {
        const style: any = {
          color: textColor,
          fontFamily,
          fontSize: baseFontSize,
          lineHeight: baseLineHeight,
        };
        if (node.bold) style.fontWeight = 'bold';
        if (node.italic) style.fontStyle = 'italic';
        if (node.code) {
          style.fontFamily = Platform.OS === 'ios' ? 'Courier' : 'monospace';
          style.backgroundColor = borderColor;
          style.paddingHorizontal = 4;
          style.borderRadius = 3;
        }

        const segments = getHighlightSegments(node.text || '', annotations);
        return (
          <React.Fragment key={key}>
            {segments.map((seg, idx) => {
              if (seg.isHighlighted) {
                return (
                  <Text
                    key={idx}
                    style={[
                      style,
                      {
                        backgroundColor: seg.color || 'hsl(48, 100%, 65%)',
                        color: 'hsl(220, 15%, 8%)',
                        fontWeight: '600',
                        borderRadius: 3,
                      }
                    ]}
                    onPress={seg.annotation && onPressBlock ? () => onPressBlock(block, [seg.annotation!]) : undefined}
                  >
                    {seg.text}
                  </Text>
                );
              }
              return (
                <Text key={idx} style={style}>
                  {seg.text}
                </Text>
              );
            })}
          </React.Fragment>
        );
      }

      case 'link': {
        return (
          <Text
            key={key}
            style={{
              color: accentColor,
              textDecorationLine: 'underline',
              fontFamily,
              fontSize: baseFontSize,
              lineHeight: baseLineHeight,
            }}
            onPress={() => {
              // Action when hyperlinked elements are touched
            }}
          >
            {node.children.map((child, idx) => renderAST(child, `link-child-${idx}`))}
          </Text>
        );
      }

      case 'image': {
        const docDir = FileSystem.documentDirectory || '';
        const localUri = node.src.replace(/local-asset:\/\//g, `${docDir}documents/images/`);
        return (
          <View key={key} style={styles.imageContainer}>
            <Image
              source={{ uri: localUri }}
              style={styles.image}
              resizeMode="contain"
            />
            {node.alt && (
              <Text style={[styles.imageCaption, { color: textColor, fontFamily }]}>
                {node.alt}
              </Text>
            )}
            {node.caption && (
              <Text style={[styles.imageCaption, { color: textColor, fontFamily }]}>
                {node.caption}
              </Text>
            )}
          </View>
        );
      }

      case 'quote': {
        return (
          <View key={key} style={[styles.quoteContainer, {
            borderLeftColor: accentColor,
            backgroundColor: blockquoteBackground,
            borderColor,
          }]}>
            <Text style={{
              color: textColor,
              fontFamily,
              fontSize: baseFontSize,
              lineHeight: baseLineHeight,
            }}>
              {node.children.map((child, idx) => renderAST(child, `quote-child-${idx}`))}
            </Text>
          </View>
        );
      }

      case 'code_block': {
        return (
          <View key={key} style={[styles.codeBlockContainer, {
            backgroundColor: blockquoteBackground,
            borderColor,
          }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={[styles.codeBlockText, {
                color: textColor,
                fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                fontSize: baseFontSize * 0.9,
              }]}>
                {node.code}
              </Text>
            </ScrollView>
          </View>
        );
      }

      case 'list': {
        return (
          <View key={key} style={styles.listContainer}>
            {node.items.map((item, itemIdx) => (
              <View key={itemIdx} style={styles.listItemRow}>
                <Text style={[styles.bullet, { color: accentColor, fontSize: baseFontSize }]}>
                  {node.ordered ? `${itemIdx + 1}. ` : '• '}
                </Text>
                <View style={styles.listItemContent}>
                  <Text style={{
                    color: textColor,
                    fontFamily,
                    fontSize: baseFontSize,
                    lineHeight: baseLineHeight,
                  }}>
                    {item.children.map((child, idx) => renderAST(child, `li-child-${idx}`))}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        );
      }

      case 'table': {
        return (
          <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
            <View style={[styles.tableContainer, { borderColor }]}>
              {node.rows.map((row, rowIdx) => (
                <View key={rowIdx} style={styles.tableRow}>
                  {row.cells.map((cell, cellIdx) => (
                    <View
                      key={cellIdx}
                      style={[
                        styles.tableCell,
                        {
                          borderColor,
                          backgroundColor: cell.is_header ? thBackground : 'transparent',
                        }
                      ]}
                    >
                      <Text style={{
                        color: cell.is_header ? headingColor : textColor,
                        fontWeight: cell.is_header ? 'bold' : 'normal',
                        fontFamily,
                        fontSize: baseFontSize * 0.9,
                      }}>
                        {cell.children.map((child, idx) => renderAST(child, `cell-child-${idx}`))}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }

      default:
        return null;
    }
  };

  const handlePress = () => {
    if (onPressBlock) {
      onPressBlock(block, annotations);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={onPressBlock ? 0.85 : 1}
      onPress={onPressBlock ? handlePress : undefined}
      style={[styles.cellContainer, { backgroundColor }]}
      testID={`block-cell-${block.id}`}
    >
      {renderAST(ast, 'root')}
      {annotations.length > 0 && (
        <View style={styles.badgeContainer}>
          {annotations.map((ann, idx) => (
            <View
              key={ann.id || idx}
              style={[styles.indicatorDot, { backgroundColor: ann.color_code }]}
            />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cellContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  headingContainer: {
    marginVertical: 10,
  },
  headingText: {
    fontWeight: 'bold',
  },
  paragraphText: {
    marginVertical: 6,
  },
  imageContainer: {
    marginVertical: 10,
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 6,
  },
  imageCaption: {
    fontSize: 12,
    marginTop: 6,
    opacity: 0.8,
    textAlign: 'center',
  },
  quoteContainer: {
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  codeBlockContainer: {
    borderWidth: 1,
    padding: 12,
    marginVertical: 8,
    borderRadius: 4,
  },
  codeBlockText: {
    lineHeight: 18,
  },
  listContainer: {
    marginVertical: 8,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
  },
  bullet: {
    width: 20,
    fontWeight: 'bold',
  },
  listItemContent: {
    flex: 1,
  },
  tableScroll: {
    marginVertical: 10,
  },
  tableContainer: {
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    padding: 8,
    borderWidth: 0.5,
    minWidth: 100,
    justifyContent: 'center',
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
});
