import { describe, it, expect } from "vitest";
import { detectMediaFormat, isSupportedMediaFile, isVideoFile, extFromContentType } from "./media-format";

describe("detectMediaFormat", () => {
  it("実際のDropboxファイル名を判定する", () => {
    // 2026-08-15 Cheese Cheese Worker 千葉店 のフォルダにあった実物
    expect(detectMediaFormat("写真投稿26-8-2 (1).png")).toBe("PHOTO");
    expect(detectMediaFormat("写真投稿26-8-2 (1).MOV")).toBe("VIDEO");
    expect(detectMediaFormat("写真投稿26-8-2 (2).mov")).toBe("VIDEO");
  });

  it("写真の拡張子", () => {
    for (const n of ["a.jpg", "a.JPEG", "a.png", "a.gif", "a.webp", "a.bmp"]) {
      expect(detectMediaFormat(n)).toBe("PHOTO");
    }
  });

  it("動画の拡張子（GBP対応形式のみ）", () => {
    expect(detectMediaFormat("a.mp4")).toBe("VIDEO");
    expect(detectMediaFormat("a.m4v")).toBe("VIDEO");
    expect(detectMediaFormat("a.avi")).toBeNull();
    expect(detectMediaFormat("a.wmv")).toBeNull();
  });

  it("URLはクエリを無視してパスで判定する", () => {
    expect(detectMediaFormat("https://www.dropbox.com/s/x/photo.jpg?dl=1")).toBe("PHOTO");
    expect(detectMediaFormat("https://www.dropbox.com/s/x/movie.MOV?dl=0")).toBe("VIDEO");
    expect(detectMediaFormat("https://xxx.supabase.co/storage/v1/object/public/post-images/sched-1.mp4")).toBe("VIDEO");
    expect(detectMediaFormat("https://example.com/a.png#frag")).toBe("PHOTO");
  });

  it("URLエンコードされた日本語ファイル名も判定できる", () => {
    expect(detectMediaFormat("https://example.com/%E5%86%99%E7%9C%9F.jpg")).toBe("PHOTO");
  });

  it("拡張子がわからないURL（Dropbox一時リンク等）はnull", () => {
    expect(detectMediaFormat("https://uc123.dl.dropboxusercontent.com/cd/0/get/ABC/file")).toBeNull();
    expect(detectMediaFormat("")).toBeNull();
  });

  it("ヘルパー", () => {
    expect(isSupportedMediaFile("a.jpg")).toBe(true);
    expect(isSupportedMediaFile("a.mov")).toBe(true);
    expect(isSupportedMediaFile("a.txt")).toBe(false);
    expect(isVideoFile("a.mov")).toBe(true);
    expect(isVideoFile("a.jpg")).toBe(false);
  });
});

describe("extFromContentType", () => {
  it("Content-Typeから拡張子を決める", () => {
    expect(extFromContentType("image/png")).toBe("png");
    expect(extFromContentType("image/jpeg")).toBe("jpg");
    expect(extFromContentType("image/webp")).toBe("webp");
    expect(extFromContentType("video/quicktime")).toBe("mov");
    expect(extFromContentType("video/mp4")).toBe("mp4");
  });

  it("octet-streamのときは元のファイル名から拾う", () => {
    expect(extFromContentType("application/octet-stream", "写真投稿26-8-2 (1).MOV")).toBe("mov");
    expect(extFromContentType("application/octet-stream", "a.png")).toBe("png");
    // 未知の拡張子は既定のjpgに落とす（従来挙動）
    expect(extFromContentType("application/octet-stream", "a.txt")).toBe("jpg");
    expect(extFromContentType("")).toBe("jpg");
  });
});
