const fs = require('fs');

const plainText = 'Some subtopic block text containing <span class="highlight">crucial details</span> here.';
const highlightRegex = /<span class="highlight">([\s\S]*?)<\/span>|<mark>([\s\S]*?)<\/mark>/g;
let match;
const highlights = [];
while ((match = highlightRegex.exec(plainText)) !== null) {
  const text = (match[1] || match[2] || '').replace(/<[^>]*>/g, '').trim();
  if (text) highlights.push(text);
}
console.log(highlights);
