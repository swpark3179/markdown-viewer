import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { marked, Renderer } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Theme = "light" | "dark";
type BookmarkKind = "file" | "heading";

type NativeMarkdownFile = {
  path: string;
  name: string;
  content: string;
  size: number;
  modified: number | null;
};

type ViewerDocument = NativeMarkdownFile & {
  id: string;
  scrollTop: number;
};

type ViewerTab = {
  id: string;
  path: string;
};

type Bookmark = {
  id: string;
  kind: BookmarkKind;
  filePath: string;
  fileName: string;
  headingId?: string;
  scrollTop?: number;
  label: string;
  createdAt: number;
  updatedAt: number;
};

type RecentFile = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

type FontInfo = {
  family: string;
  source: string;
};

type StoredState = {
  theme?: Theme;
  fontFamily?: string;
  zoom?: number;
  sidebarOpen?: boolean;
  recentFiles?: RecentFile[];
  bookmarks?: Bookmark[];
};

const STORAGE_KEY = "markdown-viewer-tauri-v1";
const CLAUDE_FONT = "Claude Serif (기본)";
const DEFAULT_FONTS = [
  CLAUDE_FONT,
  "Segoe UI",
  "Malgun Gothic",
  "Georgia",
  "Times New Roman",
  "Cambria",
  "Verdana",
  "Consolas",
];

const HELP_DOC: ViewerDocument = {
  id: "help://guide",
  path: "help://guide",
  name: "도움말.md",
  size: 0,
  modified: null,
  scrollTop: 0,
  content: [
    "# 마크다운 뷰어 사용 안내",
    "",
    "## 파일 여는 방법",
    "",
    "1. 상단 메뉴 **파일 > 열기...** (`Ctrl+O`) 에서 파일을 선택",
    "2. 마크다운 파일을 이 창으로 **드래그&드롭**",
    "3. Windows 탐색기에서 `.md` 파일 우클릭 후 **마크다운 뷰어로 열기**",
    "",
    "> 이 프로그램은 **읽기 전용**입니다. 문서를 수정하거나 저장하지 않습니다.",
    "",
    "## 북마크",
    "",
    "- **파일 북마크** - 툴바의 책갈피 버튼 또는 `Ctrl+D`",
    "- **위치 북마크** - 본문 제목에 마우스를 올리면 나타나는 책갈피 버튼 클릭",
    "- 북마크 패널에서 이름을 바로 편집할 수 있습니다.",
    "",
    "## Mermaid",
    "",
    "```mermaid",
    "flowchart TD",
    "  A([마크다운 파일]) --> B[읽기 전용 렌더링]",
    "  B --> C{Mermaid 코드 블록?}",
    "  C -->|예| D[다이어그램 표시]",
    "  C -->|아니오| E[일반 문서 표시]",
    "```",
  ].join("\n"),
};

function loadStoredState(): StoredState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fontStack(fontFamily: string): string {
  if (fontFamily === CLAUDE_FONT) {
    return "'Source Serif 4','Noto Serif KR',Georgia,serif";
  }
  return `"${fontFamily}","Malgun Gothic","Segoe UI",sans-serif`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round((size / 1024) * 10) / 10} KB`;
  return `${Math.round((size / 1024 / 1024) * 10) / 10} MB`;
}

function docStats(doc?: ViewerDocument): string {
  if (!doc) return "";
  const lines = doc.content.split("\n").length;
  const words = doc.content.split(/\s+/).filter(Boolean).length;
  return `${lines}줄 · ${words}단어 · ${doc.content.length.toLocaleString()}자 · ${formatBytes(doc.size)}`;
}

function asDocument(file: NativeMarkdownFile): ViewerDocument {
  return { ...file, id: file.path, scrollTop: 0 };
}

function uniqRecent(files: RecentFile[], next: RecentFile): RecentFile[] {
  return [next, ...files.filter((file) => file.path !== next.path)].slice(0, 12);
}

function supportedPath(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

function bookmarkId(kind: BookmarkKind, filePath: string, headingId?: string): string {
  return `${kind}:${filePath}:${headingId || ""}`;
}

function App() {
  const stored = useMemo(loadStoredState, []);
  const [theme, setTheme] = useState<Theme>(stored.theme || "light");
  const [fontFamily, setFontFamily] = useState(stored.fontFamily || CLAUDE_FONT);
  const [zoom, setZoom] = useState(stored.zoom || 1);
  const [sidebarOpen, setSidebarOpen] = useState(stored.sidebarOpen || false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(stored.recentFiles || []);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(stored.bookmarks || []);
  const [documents, setDocuments] = useState<Record<string, ViewerDocument>>({ [HELP_DOC.id]: HELP_DOC });
  const [tabs, setTabs] = useState<ViewerTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [fonts, setFonts] = useState<string[]>(DEFAULT_FONTS);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollMemory = useRef<Record<string, number>>({});
  const activeDoc = activeId ? documents[activeId] : undefined;
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const reportWindowError = useCallback((err: unknown) => {
    setError(`창 제어 오류: ${String(err)}`);
  }, []);

  const startWindowDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.detail > 1) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,input,a,[data-no-window-drag]")) return;
      event.preventDefault();
      appWindow.startDragging().catch(reportWindowError);
    },
    [appWindow, reportWindowError],
  );

  const toggleWindowMaximize = useCallback(
    (event?: React.MouseEvent) => {
      event?.stopPropagation();
      appWindow.toggleMaximize().catch(reportWindowError);
    },
    [appWindow, reportWindowError],
  );

  const minimizeWindow = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      appWindow.minimize().catch(reportWindowError);
    },
    [appWindow, reportWindowError],
  );

  const closeWindow = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      appWindow.close().catch(reportWindowError);
    },
    [appWindow, reportWindowError],
  );

  const updateStored = useCallback(() => {
    const state: StoredState = { theme, fontFamily, zoom, sidebarOpen, recentFiles, bookmarks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [theme, fontFamily, zoom, sidebarOpen, recentFiles, bookmarks]);

  useEffect(() => {
    updateStored();
  }, [updateStored]);

  const openDocuments = useCallback((files: NativeMarkdownFile[]) => {
    if (!files.length) return;
    const docs = files.map(asDocument);
    setDocuments((current) => {
      const next = { ...current };
      for (const doc of docs) next[doc.id] = { ...doc, scrollTop: scrollMemory.current[doc.id] || 0 };
      return next;
    });
    setTabs((current) => {
      const known = new Set(current.map((tab) => tab.id));
      return [...current, ...docs.filter((doc) => !known.has(doc.id)).map((doc) => ({ id: doc.id, path: doc.path }))];
    });
    setActiveId(docs[docs.length - 1].id);
    setRecentFiles((current) => {
      let next = current;
      for (const doc of docs) {
        next = uniqRecent(next, { path: doc.path, name: doc.name, lastOpenedAt: Date.now() });
      }
      return next;
    });
  }, []);

  const openPaths = useCallback(
    async (paths: string[]) => {
      const filtered = paths.filter(supportedPath);
      if (!filtered.length) return;
      try {
        setError(null);
        const docs = await invoke<NativeMarkdownFile[]>("read_markdown_files", { paths: filtered });
        openDocuments(docs);
      } catch (err) {
        setError(String(err));
      }
    },
    [openDocuments],
  );

  const openFileDialog = useCallback(async () => {
    setOpenMenu(null);
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!selected) return;
    await openPaths(Array.isArray(selected) ? selected : [selected]);
  }, [openPaths]);

  const openRecent = useCallback(
    async (path: string) => {
      await openPaths([path]);
      setOpenMenu(null);
    },
    [openPaths],
  );

  const selectTab = useCallback(
    (id: string) => {
      if (activeId && scrollRef.current) {
        scrollMemory.current[activeId] = scrollRef.current.scrollTop;
      }
      setActiveId(id);
      setOpenMenu(null);
    },
    [activeId],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id);
        const next = current.filter((tab) => tab.id !== id);
        if (activeId === id) setActiveId(next[Math.max(0, index - 1)]?.id || null);
        return next;
      });
    },
    [activeId],
  );

  const clampZoom = useCallback((next: number) => Math.min(2.5, Math.max(0.5, Math.round(next * 10) / 10)), []);
  const zoomBy = useCallback((delta: number) => setZoom((current) => clampZoom(current + delta)), [clampZoom]);

  const toggleFileBookmark = useCallback(() => {
    if (!activeDoc || activeDoc.path.startsWith("help://")) return;
    const id = bookmarkId("file", activeDoc.path);
    setBookmarks((current) => {
      if (current.some((bookmark) => bookmark.id === id)) return current.filter((bookmark) => bookmark.id !== id);
      const now = Date.now();
      return [
        ...current,
        {
          id,
          kind: "file",
          filePath: activeDoc.path,
          fileName: activeDoc.name,
          label: activeDoc.name,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
  }, [activeDoc]);

  const goToBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (!documents[bookmark.filePath]) {
        await openPaths([bookmark.filePath]);
      }
      setActiveId(bookmark.filePath);
      requestAnimationFrame(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        if (bookmark.headingId) {
          const target = contentRef.current?.querySelector<HTMLElement>(`#${CSS.escape(bookmark.headingId)}`);
          if (target) {
            const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 28;
            scroller.scrollTop = Math.max(0, top);
            return;
          }
        }
        scroller.scrollTop = bookmark.scrollTop || 0;
      });
    },
    [documents, openPaths],
  );

  const updateBookmarkLabel = useCallback((id: string, label: string) => {
    setBookmarks((current) =>
      current.map((bookmark) => (bookmark.id === id ? { ...bookmark, label, updatedAt: Date.now() } : bookmark)),
    );
  }, []);

  useEffect(() => {
    const renderer = new Renderer();
    renderer.code = (code: string, info = "") => {
      const lang = info.trim().split(/\s+/)[0];
      if (lang === "mermaid") {
        return `<div class="mmd-card"><div class="mermaid">${escapeHtml(code)}</div></div>`;
      }
      let html = escapeHtml(code);
      if (lang && hljs.getLanguage(lang)) {
        try {
          html = hljs.highlight(code, { language: lang }).value;
        } catch {
          html = escapeHtml(code);
        }
      }
      return `<div class="cb"><div class="cbh">${escapeHtml(lang || "text")}</div><pre class="cbp"><code>${html}</code></pre></div>`;
    };
    marked.use({ gfm: true, renderer });
  }, []);

  useEffect(() => {
    if (!activeDoc || !contentRef.current) return;
    let html = "";
    try {
      html = marked.parse(activeDoc.content) as string;
    } catch (err) {
      html = `<p>렌더링 오류: ${escapeHtml(String(err))}</p>`;
    }
    const content = contentRef.current;
    content.innerHTML = html;
    content.querySelectorAll("h1,h2,h3,h4").forEach((heading, index) => {
      const element = heading as HTMLElement;
      const headingId = `h-${index}`;
      const label = element.textContent?.trim() || `위치 ${index + 1}`;
      element.id = headingId;
      const button = document.createElement("button");
      button.className = "bmk";
      button.title = "이 위치 북마크";
      button.dataset.headingId = headingId;
      button.dataset.label = label;
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16"><path class="bi" d="M4 2h8v12l-4-3.2L4 14V2z"></path></svg>';
      if (bookmarks.some((bookmark) => bookmark.filePath === activeDoc.path && bookmark.headingId === headingId)) {
        button.classList.add("on");
      }
      element.appendChild(button);
    });

    const scroller = scrollRef.current;
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = scrollMemory.current[activeDoc.id] || activeDoc.scrollTop || 0;
    });

    const nodes = content.querySelectorAll<HTMLElement>(".mermaid");
    if (nodes.length) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        fontFamily: fontStack(fontFamily),
        themeVariables: mermaidTheme(theme),
        flowchart: { curve: "basis" },
      });
      mermaid.run({ nodes }).catch(() => undefined);
    }
  }, [activeDoc, bookmarks, fontFamily, theme]);

  useEffect(() => {
    invoke<FontInfo[]>("list_system_fonts")
      .then((items) => {
        const systemFonts = items.map((item) => item.family).filter(Boolean);
        setFonts([...new Set([CLAUDE_FONT, ...DEFAULT_FONTS, ...systemFonts])]);
      })
      .catch(() => setFonts(DEFAULT_FONTS));
  }, []);

  useEffect(() => {
    invoke<string[]>("startup_files")
      .then(openPaths)
      .catch(() => undefined);
    const unlistenPromise = listen<string[]>("open-files", (event) => openPaths(event.payload));
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [openPaths]);

  useEffect(() => {
    const unlistenPromise = appWindow.onDragDropEvent((event) => {
      const payload = event.payload as { type: string; paths?: string[] };
      if (payload.type === "over") setDropActive(true);
      if (payload.type === "drop") {
        setDropActive(false);
        openPaths(payload.paths || []);
      }
      if (payload.type === "cancel") setDropActive(false);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [appWindow, openPaths]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey) {
        if (event.key === "Escape") setOpenMenu(null);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        openFileDialog();
      } else if (key === "w") {
        event.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (key === "b") {
        event.preventDefault();
        setSidebarOpen((current) => !current);
      } else if (key === "d") {
        event.preventDefault();
        toggleFileBookmark();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        zoomBy(0.1);
      } else if (key === "-") {
        event.preventDefault();
        zoomBy(-0.1);
      } else if (key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeId, closeTab, openFileDialog, toggleFileBookmark, zoomBy]);

  const fileBookmarked = !!activeDoc && bookmarks.some((bookmark) => bookmark.id === bookmarkId("file", activeDoc.path));
  const fileBookmarks = bookmarks.filter((bookmark) => bookmark.kind === "file");
  const headingBookmarks = bookmarks.filter((bookmark) => bookmark.kind === "heading");

  const onContentClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const bookmarkButton = target.closest<HTMLButtonElement>(".bmk");
      if (bookmarkButton && activeDoc) {
        const headingId = bookmarkButton.dataset.headingId || "";
        const label = bookmarkButton.dataset.label || "북마크";
        const id = bookmarkId("heading", activeDoc.path, headingId);
        const scrollTop = scrollRef.current?.scrollTop || 0;
        setBookmarks((current) => {
          if (current.some((bookmark) => bookmark.id === id)) return current.filter((bookmark) => bookmark.id !== id);
          const now = Date.now();
          return [
            ...current,
            {
              id,
              kind: "heading",
              filePath: activeDoc.path,
              fileName: activeDoc.name,
              headingId,
              scrollTop,
              label,
              createdAt: now,
              updatedAt: now,
            },
          ];
        });
        return;
      }
      if (target.closest("a")) event.preventDefault();
    },
    [activeDoc],
  );

  const saveScroll = useCallback(() => {
    if (activeId && scrollRef.current) scrollMemory.current[activeId] = scrollRef.current.scrollTop;
  }, [activeId]);

  return (
    <div data-mdv data-theme={theme} className="app-shell">
      <div className="title-bar" onMouseDown={startWindowDrag} onDoubleClick={toggleWindowMaximize}>
        <Logo />
        <span className="window-title">{activeDoc ? `${activeDoc.name} - ` : ""}마크다운 뷰어</span>
        <span className="readonly-pill">읽기 전용</span>
        <div className="title-spacer" />
        <button className="window-btn" title="최소화" onClick={minimizeWindow}>
          <MinusIcon />
        </button>
        <button className="window-btn" title="최대화" onClick={toggleWindowMaximize}>
          <MaximizeIcon />
        </button>
        <button className="window-btn close" title="닫기" onClick={closeWindow}>
          <CloseIcon />
        </button>
      </div>

      <div className="menu-bar">
        <MenuButton id="file" label="파일" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <MenuItem label="열기..." shortcut="Ctrl+O" onClick={openFileDialog} />
          <MenuDivider />
          <MenuItem label="탭 닫기" shortcut="Ctrl+W" disabled={!activeId} onClick={() => activeId && closeTab(activeId)} />
          <MenuItem label="모든 탭 닫기" disabled={!tabs.length} onClick={() => { setTabs([]); setActiveId(null); }} />
          <MenuDivider />
          <div className="menu-caption">최근 파일</div>
          {recentFiles.length ? (
            recentFiles.map((file) => <MenuItem key={file.path} label={file.name} hint={file.path} onClick={() => openRecent(file.path)} />)
          ) : (
            <MenuItem label="최근 파일 없음" disabled />
          )}
        </MenuButton>
        <MenuButton id="view" label="보기" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <MenuItem label="다크 모드" check={theme === "dark"} onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} />
          <MenuItem label="북마크 패널" shortcut="Ctrl+B" check={sidebarOpen} onClick={() => setSidebarOpen((current) => !current)} />
          <MenuDivider />
          <MenuItem label="확대" shortcut="Ctrl + +" onClick={() => zoomBy(0.1)} />
          <MenuItem label="축소" shortcut="Ctrl + -" onClick={() => zoomBy(-0.1)} />
          <MenuItem label="원본 크기" shortcut="Ctrl + 0" onClick={() => setZoom(1)} />
        </MenuButton>
        <MenuButton id="font" label="글꼴" openMenu={openMenu} setOpenMenu={setOpenMenu} wide>
          {fonts.map((font) => (
            <MenuItem
              key={font}
              label={font}
              check={fontFamily === font}
              style={{ fontFamily: fontStack(font) }}
              onClick={() => {
                setFontFamily(font);
                setOpenMenu(null);
              }}
            />
          ))}
        </MenuButton>
        <MenuButton id="bookmark" label="북마크" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <MenuItem label={fileBookmarked ? "현재 파일 북마크 해제" : "현재 파일 북마크"} shortcut="Ctrl+D" disabled={!activeDoc} check={fileBookmarked} onClick={toggleFileBookmark} />
          <MenuItem label={sidebarOpen ? "북마크 패널 숨기기" : "북마크 패널 표시"} shortcut="Ctrl+B" onClick={() => setSidebarOpen((current) => !current)} />
          {!!bookmarks.length && <MenuDivider />}
          {bookmarks.slice(0, 8).map((bookmark) => (
            <MenuItem key={bookmark.id} label={bookmark.label} hint={bookmark.fileName} onClick={() => goToBookmark(bookmark)} />
          ))}
        </MenuButton>
        <MenuButton id="help" label="도움말" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <MenuItem
            label="사용 안내"
            onClick={() => {
              setTabs((current) => (current.some((tab) => tab.id === HELP_DOC.id) ? current : [...current, { id: HELP_DOC.id, path: HELP_DOC.path }]));
              setActiveId(HELP_DOC.id);
              setOpenMenu(null);
            }}
          />
          <MenuDivider />
          <MenuItem label="마크다운 뷰어 v0.1" disabled />
        </MenuButton>

        <div className="toolbar-spacer" />
        <ToolbarButton title="파일 열기 (Ctrl+O)" onClick={openFileDialog}><FolderIcon /></ToolbarButton>
        <ToolbarButton title="현재 파일 북마크 (Ctrl+D)" onClick={toggleFileBookmark}><BookmarkIcon filled={fileBookmarked} /></ToolbarButton>
        <ToolbarButton title="북마크 패널 (Ctrl+B)" active={sidebarOpen} onClick={() => setSidebarOpen((current) => !current)}><PanelIcon /></ToolbarButton>
        <div className="toolbar-sep" />
        <ToolbarButton title="축소" onClick={() => zoomBy(-0.1)}><ZoomOutIcon /></ToolbarButton>
        <button className="zoom-reset" title="원본 크기 (Ctrl+0)" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <ToolbarButton title="확대" onClick={() => zoomBy(0.1)}><ZoomInIcon /></ToolbarButton>
        <div className="toolbar-sep" />
        <ToolbarButton title="테마 전환" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</ToolbarButton>
      </div>

      <div className="tab-strip">
        {tabs.map((tab) => {
          const doc = documents[tab.id];
          const active = tab.id === activeId;
          const bookmarked = bookmarks.some((bookmark) => bookmark.id === bookmarkId("file", tab.path));
          return (
            <button key={tab.id} className={`tab ${active ? "active" : ""}`} onClick={() => selectTab(tab.id)}>
              {bookmarked && <BookmarkIcon filled small />}
              <span>{doc?.name || tab.path}</span>
              <span className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>×</span>
            </button>
          );
        })}
      </div>

      <main className="body">
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>북마크</strong>
              <span>{bookmarks.length}</span>
              <button onClick={() => setSidebarOpen(false)}>×</button>
            </div>
            <BookmarkSection title="파일" empty="Ctrl+D 로 파일을 북마크하세요" items={fileBookmarks} onGo={goToBookmark} onRemove={(id) => setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id))} onLabel={updateBookmarkLabel} />
            <BookmarkSection title="위치" empty="본문 제목에 마우스를 올려 책갈피를 클릭하세요" items={headingBookmarks} onGo={goToBookmark} onRemove={(id) => setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id))} onLabel={updateBookmarkLabel} />
          </aside>
        )}

        <section
          ref={scrollRef}
          className="viewer"
          onScroll={saveScroll}
          onWheel={(event) => {
            if (event.ctrlKey) {
              event.preventDefault();
              zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
            }
          }}
        >
          {activeDoc ? (
            <div className="content-wrap" style={{ "--viewer-font": fontStack(fontFamily), "--viewer-zoom": String(zoom) } as React.CSSProperties}>
              <div className="mdv" ref={contentRef} onClick={onContentClick} />
            </div>
          ) : (
            <div className="empty-state">
              <Logo large />
              <div>열린 문서가 없습니다</div>
              <p><kbd>Ctrl+O</kbd> 로 파일을 열거나, 마크다운 파일을 이 창으로 끌어다 놓으세요</p>
              <button onClick={openFileDialog}>파일 열기...</button>
            </div>
          )}
        </section>
      </main>

      <div className="status-bar">
        <span className="status-accent">읽기 전용</span>
        <span>UTF-8</span>
        <span>Markdown</span>
        <div className="status-spacer" />
        {error && <span className="status-error">{error}</span>}
        <span>{docStats(activeDoc)}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>

      {openMenu && <div className="menu-backdrop" onClick={() => setOpenMenu(null)} />}
      {dropActive && (
        <div className="drop-overlay">
          <div>
            <FolderIcon />
            <strong>마크다운 파일을 여기에 놓으세요</strong>
            <span>.md · .markdown · .txt</span>
          </div>
        </div>
      )}
    </div>
  );
}

function mermaidTheme(theme: Theme): Record<string, string | boolean> {
  const acc = "#D97757";
  const common = {
    primaryBorderColor: acc,
    actorBorder: acc,
    noteBorderColor: acc,
    pie1: acc,
    pie2: "#8A9A5B",
    pie3: "#B58E4F",
    pie4: "#6E8CC7",
    pie5: "#A26769",
    pie6: "#7A5CA8",
    pieOpacity: "0.88",
    fontSize: "15px",
    activeTaskBkgColor: acc,
    activeTaskBorderColor: acc,
  };
  if (theme === "dark") {
    return {
      ...common,
      darkMode: true,
      background: "#262624",
      mainBkg: "#33322E",
      primaryColor: "#33322E",
      primaryTextColor: "#F0EEE6",
      lineColor: "#7B776C",
      textColor: "#D6D2C6",
      secondaryColor: "#3E3C36",
      tertiaryColor: "#2B2A27",
      clusterBkg: "#2B2A27",
      edgeLabelBackground: "#2E2D2A",
      noteBkgColor: "#4A3A30",
      noteTextColor: "#F0EEE6",
    };
  }
  return {
    ...common,
    background: "#FAF9F5",
    mainBkg: "#F0EDE4",
    primaryColor: "#F0EDE4",
    primaryTextColor: "#141413",
    lineColor: "#A29D90",
    textColor: "#3D3B35",
    secondaryColor: "#E5E1D5",
    tertiaryColor: "#F7F5EE",
    clusterBkg: "#F5F2EA",
    edgeLabelBackground: "#EFECE3",
    noteBkgColor: "#F6E3D3",
    noteTextColor: "#42403A",
  };
}

function MenuButton(props: {
  id: string;
  label: string;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const open = props.openMenu === props.id;
  return (
    <div className="menu-root">
      <button className={`menu-trigger ${open ? "active" : ""}`} onClick={() => props.setOpenMenu(open ? null : props.id)} onMouseEnter={() => props.openMenu && props.setOpenMenu(props.id)}>
        {props.label}
      </button>
      {open && <div className={`menu-popover ${props.wide ? "wide" : ""}`}>{props.children}</div>}
    </div>
  );
}

function MenuItem(props: {
  label: string;
  shortcut?: string;
  hint?: string;
  check?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  return (
    <button className="menu-item" disabled={props.disabled} onClick={props.onClick} style={props.style}>
      <span className="menu-check">{props.check ? "✓" : ""}</span>
      <span className="menu-label">{props.label}</span>
      {props.hint && <span className="menu-hint">{props.hint}</span>}
      {props.shortcut && <span className="menu-shortcut">{props.shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="menu-divider" />;
}

function ToolbarButton(props: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`toolbar-btn ${props.active ? "active" : ""}`} title={props.title} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function BookmarkSection(props: {
  title: string;
  empty: string;
  items: Bookmark[];
  onGo: (bookmark: Bookmark) => void;
  onRemove: (id: string) => void;
  onLabel: (id: string, label: string) => void;
}) {
  return (
    <div className="bookmark-section">
      <div className="section-title">{props.title}</div>
      {props.items.length ? props.items.map((bookmark) => (
        <div key={bookmark.id} className="bookmark-row" onClick={() => props.onGo(bookmark)}>
          <BookmarkIcon filled={bookmark.kind === "file"} small />
          <div className="bookmark-main">
            <input value={bookmark.label} onClick={(event) => event.stopPropagation()} onChange={(event) => props.onLabel(bookmark.id, event.target.value)} />
            <span>{bookmark.fileName}</span>
          </div>
          <button onClick={(event) => { event.stopPropagation(); props.onRemove(bookmark.id); }}>×</button>
        </div>
      )) : <div className="bookmark-empty">{props.empty}</div>}
    </div>
  );
}

function Logo({ large = false }: { large?: boolean }) {
  return (
    <svg width={large ? 44 : 15} height={large ? 44 : 15} viewBox="0 0 16 16" className="logo">
      <path d="M8 1v14M1 8h14M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.5 3.5h4l1.5 2h7.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" /></svg>;
}

function BookmarkIcon({ filled = false, small = false }: { filled?: boolean; small?: boolean }) {
  return <svg width={small ? 11 : 15} height={small ? 11 : 15} viewBox="0 0 16 16"><path d="M4 2h8v12l-4-3.2L4 14V2z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

function PanelIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M6 2.5v11" /></svg>;
}

function ZoomOutIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5M5 7h4" /></svg>;
}

function ZoomInIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5M5 7h4M7 5v4" /></svg>;
}

function SunIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="3.4" /><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" /></svg>;
}

function MoonIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" /></svg>;
}

function MinusIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>;
}

function MaximizeIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
}

function CloseIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>;
}

export default App;
