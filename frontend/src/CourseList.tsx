import React, { useEffect, useState } from "react";
import { Card, List, Button, message, Upload, Modal, Progress } from "antd";
import {
  UploadOutlined,
  BookOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { Course, Document } from "./types";
import {
  fetchCourses,
  uploadCourseFile,
  generateLecture,
  assessMastery,
} from "./api";

const CourseList: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState<Course | null>(null);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [script, setScript] = useState("");
  const [assessing, setAssessing] = useState(false);
  const [mastery, setMastery] = useState<
    Array<{ point: string; mastery: number }>
  >([]);

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    setLoading(true);
    try {
      const data = await fetchCourses();
      setCourses(data);
    } catch (error) {
      message.error("Failed to load courses");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (courseId: string, file: File) => {
    setUploading(true);
    try {
      await uploadCourseFile(courseId, file);
      message.success("File uploaded successfully");
      loadCourses(); // Refresh list to show new doc count or details
    } catch (error) {
      message.error("Upload failed");
    } finally {
      setUploading(false);
    }
    return false; // Prevent default auto upload
  };

  const handleEnterClass = (course: Course) => {
    setCurrent(course);
    setOpen(true);
    setScript("");
    setMastery([]);
  };

  const handleGenerate = async () => {
    if (!current) return;
    setGenerating(true);
    try {
      const res = await generateLecture(current.name);
      setScript(res.script || "");
    } catch (e) {
      message.error("生成讲授脚本失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleSpeak = () => {
    if (!script) return;
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.lang = "zh-CN";
    s.speak(u);
  };

  const handleAssess = async () => {
    if (!current) return;
    setAssessing(true);
    try {
      const res = await assessMastery(current.name);
      setMastery(res || []);
    } catch (e) {
      message.error("掌握度检测失败");
    } finally {
      setAssessing(false);
    }
  };

  return (
    <>
      <div style={{ padding: "24px" }}>
        <h1 style={{ marginBottom: "24px" }}>My Courses</h1>
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
          dataSource={courses}
          loading={loading}
          renderItem={(course) => (
            <List.Item>
              <Card
                title={course.name}
                extra={
                  <Button type="link" onClick={() => handleEnterClass(course)}>
                    Enter
                  </Button>
                }
                actions={[
                  <Upload
                    beforeUpload={(file) => {
                      if (uploading) return false;
                      return handleUpload(course.id, file);
                    }}
                    showUploadList={false}
                    accept=".pdf,.pptx"
                  >
                    <Button
                      icon={<UploadOutlined />}
                      loading={uploading}
                      disabled={uploading}
                    >
                      {uploading ? "正在解析中..." : "增添课程文档"}
                    </Button>
                  </Upload>,
                  <Button icon={<BookOutlined />}>
                    {course.documents.length} Docs
                  </Button>,
                ]}
              >
                <div style={{ minHeight: "60px" }}>
                  <p>{course.description || "No description"}</p>
                  {course.documents.length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <FileTextOutlined /> Latest:{" "}
                      {course.documents[course.documents.length - 1].name}
                    </div>
                  )}
                </div>
              </Card>
            </List.Item>
          )}
        />
      </div>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title={current ? current.name : ""}
        footer={null}
        width={800}
      >
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <Button type="primary" onClick={handleGenerate} loading={generating}>
            生成讲授脚本
          </Button>
          <Button onClick={handleSpeak} disabled={!script}>
            朗读脚本
          </Button>
          <Button onClick={handleAssess} loading={assessing}>
            检测掌握程度
          </Button>
        </div>
        {script && (
          <div
            style={{
              whiteSpace: "pre-wrap",
              border: "1px solid #eee",
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            {script}
          </div>
        )}
        {mastery.length > 0 && (
          <div>
            {mastery.map((m) => (
              <div key={m.point} style={{ marginBottom: 10 }}>
                <div style={{ marginBottom: 4 }}>{m.point}</div>
                <Progress percent={m.mastery} />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
};

export default CourseList;
