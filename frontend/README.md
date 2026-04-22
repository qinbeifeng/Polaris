# Frontend Project Setup

This directory contains the source code for the React + Ant Design frontend.

## Prerequisites

Ensure you have Node.js installed.

## Installation

1. Initialize a React project (if not already done):

   ```bash
   npx create-react-app my-app --template typescript
   cd my-app
   ```

2. Install dependencies:

   ```bash
   npm install antd axios @ant-design/icons
   ```

3. Copy the files:
   - Copy `src/CourseList.tsx` to your project's `src/` folder.
   - Copy `src/api.ts` and `src/types.ts` to your project's `src/` folder.

4. Usage:
   Import `CourseList` in your `App.tsx`:

   ```tsx
   import CourseList from "./CourseList";

   function App() {
     return (
       <div className="App">
         <CourseList />
       </div>
     );
   }
   ```

## Features

- **Course List**: Displays courses fetched from the backend.
- **Initialization**: Official courses are automatically loaded by the backend on startup.
- **File Upload**: Supports uploading PDF/PPTX to specific courses.
- **RAG Integration**: Uploaded files are automatically processed and added to the Milvus vector database for the specific course.
