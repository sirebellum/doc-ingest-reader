import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { DbsBridge } from '../native/DbsBridge';
import type { Corpus } from "../../../rust_core/contracts/bindings/Corpus"; export type { Corpus } from "../../../rust_core/contracts/bindings/Corpus";
import type { Document } from "../../../rust_core/contracts/bindings/Document"; export type { Document } from "../../../rust_core/contracts/bindings/Document";
import type { Section } from "../../../rust_core/contracts/bindings/Section"; export type { Section } from "../../../rust_core/contracts/bindings/Section";

interface DatabaseContextProps {
  corpora: Corpus[];
  documents: Document[];
  sections: Section[];
  error: string | null;
  refreshLibrary: () => void;
  loadSectionsForDocument: (docId: string) => void;
}

const DatabaseContext = createContext<DatabaseContextProps | undefined>(undefined);

export const DatabaseProvider = ({ children }: { children: ReactNode }): React.JSX.Element => {
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = async () => {
    try {
      setError(null);
      const allCorpora = await DbsBridge.getCorporaAsync();
      setCorpora(allCorpora);
      const allDocs = await DbsBridge.getDocumentsAsync();
      setDocuments(allDocs);
    } catch (e: any) {
      console.error('Failed to fetch library from db', e);
      setError(e?.message || String(e));
      setCorpora([]);
      setDocuments([]);
    }
  };

  const loadSectionsForDocument = async (docId: string) => {
    try {
      setError(null);
      const docsSections = await DbsBridge.getSectionsForDocumentAsync(docId);
      setSections(docsSections);
    } catch (e: any) {
      console.error('Failed to fetch sections for document', e);
      setError(e?.message || String(e));
      setSections([]);
    }
  };

  useEffect(() => {
    refreshLibrary();
  }, []);

  return (
    <DatabaseContext.Provider value={{ corpora, documents, sections, error, refreshLibrary, loadSectionsForDocument }}>
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabaseSync = () => {
  const ctx = useContext(DatabaseContext);
  if (!ctx) throw new Error('useDatabaseSync must be used within DatabaseProvider');
  return ctx;
};
