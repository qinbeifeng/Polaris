export interface Document {
  id: string;
  name: string;
  path: string;
  type: string;
}

export interface Course {
  id: string;
  name: string;
  description?: string;
  documents: Document[];
}
