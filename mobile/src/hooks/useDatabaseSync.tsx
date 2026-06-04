import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { db } from '../database/schema';

export interface Corpus {
  id: string;
  name: string;
}

export interface Document {
  id: string;
  title: string;
  sha256_hash: string;
  author?: string;
  source_type?: string;
}

export interface Section {
  id: string;
  title: string;
  sort_order: number;
}

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
      const allCorpora = await db.getAllAsync('SELECT * FROM corpora ORDER BY created_at DESC') as Corpus[];
      setCorpora(allCorpora);
      const allDocs = await db.getAllAsync('SELECT * FROM documents ORDER BY created_at DESC') as Document[];
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
      const docsSections = await db.getAllAsync(
        'SELECT * FROM sections WHERE document_id = ? ORDER BY sort_order ASC', 
        [docId]
      ) as Section[];
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
