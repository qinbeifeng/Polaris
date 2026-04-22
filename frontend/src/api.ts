import axios from 'axios';
import { Course, Document } from './types';

const API_BASE_URL = 'http://localhost:8000/api'; // Adjust if needed

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export const fetchCourses = async (): Promise<Course[]> => {
  const response = await api.get<Course[]>('/courses');
  return response.data;
};

export const initCourses = async (): Promise<{ added: string[] }> => {
  const response = await api.post('/courses/init');
  return response.data;
};

export const fetchCourseDocuments = async (courseId: string): Promise<Document[]> => {
  const response = await api.get<Document[]>(`/courses/${courseId}/documents`);
  return response.data;
};

export const uploadCourseFile = async (courseId: string, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('course_id', courseId);
  
  const response = await api.post('/courses/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const generateLecture = async (courseName: string): Promise<{ script: string }> => {
  const response = await api.post('/lecture/generate', { course_name: courseName });
  return response.data;
};

export const assessMastery = async (courseName: string, studentNotes = ''): Promise<Array<{ point: string; mastery: number }>> => {
  const response = await api.post('/progress/assess', { course_name: courseName, student_notes: studentNotes });
  return response.data;
};
