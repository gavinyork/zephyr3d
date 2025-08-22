import type * as Monaco from 'monaco-editor';
import { eventBus } from '../core/eventbus';

declare global {
  interface Window {
    monaco: typeof Monaco;
  }
}

export class CodeEditor {
  private isMinimized: boolean;
  private editor: Monaco.editor.IStandaloneCodeEditor;
  protected fileName: string;
  private dirty: boolean;
  private baselineVersion: number;
  constructor(fileName: string) {
    this.isMinimized = false;
    this.fileName = fileName;
    this.editor = null;
    this.dirty = false;
    this.baselineVersion = 0;
  }

  get content(): string {
    if (this.editor) {
      return this.editor.getValue({
        preserveBOM: false,
        lineEnding: '\n'
      });
    } else {
      return null;
    }
  }

  close() {
    if (this.editor) {
      if (this.dirty && !confirm(`${this.fileName} has been changed, close it without saving?`)) {
        return false;
      }
      this.editor.getModel().dispose();
      this.editor.dispose();
      this.editor = null;
    }
    const overlay = document.getElementById('monaco-overlay');
    if (overlay) {
      overlay.remove();
    }
    return true;
  }

  async show(code: string, language: string) {
    const overlay = document.getElementById('monaco-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
    } else {
      this.createResizableEditorContainer();
    }
    const editorContainer = document.getElementById('monaco-editor-container');
    if (editorContainer) {
      await this.initMonacoEditor(editorContainer, code, language);
    }
  }

  minimize() {
    const overlay = document.getElementById('monaco-overlay');
    if (overlay) {
      this.isMinimized = true;
      overlay.classList.add('minimized');

      this.updateTitle();

      const minimizeBtn = overlay.querySelector('.minimize-btn') as HTMLButtonElement;
      if (minimizeBtn) {
        minimizeBtn.innerHTML = '□';
        minimizeBtn.title = 'Restore';
      }
    }
  }

  restore() {
    const overlay = document.getElementById('monaco-overlay');
    if (overlay) {
      this.isMinimized = false;
      overlay.classList.remove('minimized');

      this.updateTitle();

      const minimizeBtn = overlay.querySelector('.minimize-btn') as HTMLButtonElement;
      if (minimizeBtn) {
        minimizeBtn.innerHTML = '−';
        minimizeBtn.title = 'Minimize';
      }

      setTimeout(() => {
        if (this.editor) {
          this.editor.layout();
        }
      }, 100);
    }
  }

  toggleMinimize() {
    if (this.isMinimized) {
      this.restore();
    } else {
      this.minimize();
    }
  }

  updateTitle() {
    const overlay = document.getElementById('monaco-overlay');
    if (overlay) {
      const titleSpan = overlay.querySelector('.editor-title') as HTMLSpanElement;
      if (titleSpan) {
        titleSpan.textContent = `📝${this.fileName}${this.dirty ? '*' : ''}${
          this.isMinimized ? ' (Click to restore)' : ''
        }`;
        titleSpan.style.cursor = this.isMinimized ? 'pointer' : 'default';
      }
    }
  }

  saveCode() {
    if (this.editor) {
      const code = this.editor.getValue();
      eventBus.dispatchEvent('action', 'SAVE_CODE', this.fileName, code);
      this.dirty = false;
      this.updateTitle();
    }
  }

  updateLayout(): void {
    if (this.editor) {
      this.editor.layout();
    }
  }

  setLanguage(language: string): void {
    if (this.editor) {
      const model = this.editor.getModel();
      if (model) {
        window.monaco.editor.setModelLanguage(model, language);
        this.updateStatusBar();
      }
    }
  }

  getValue(): string {
    return this.editor ? this.editor.getValue() : '';
  }

  setValue(code: string): void {
    if (this.editor) {
      this.editor.setValue(code);
    }
  }
  private addEditorStyles() {
    if (document.querySelector('#monaco-editor-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'monaco-editor-styles';
    style.textContent = `
        .monaco-editor-overlay {
            position: fixed;
            top: 0;
            right: 0;
            width: 60vw;
            height: 100vh;
            background-color: #1e1e1e;
            border-left: 2px solid #333;
            z-index: 9999;
            box-shadow: -5px 0 15px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
            box-sizing: border-box;
            overflow: visible !important;
            display: flex;
            flex-direction: column; /* 关键：使用flex布局 */
        }

        .monaco-editor-overlay.hidden {
            transform: translateX(100%);
        }

        .monaco-editor-overlay.minimized {
            height: 40px;
            border-left-color: #007acc;
        }

        .monaco-editor-overlay .editor-header {
            height: 40px;
            background-color: #2d2d30;
            border-bottom: 1px solid #3e3e42;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 15px;
            color: #cccccc;
            font-size: 14px;
            flex-shrink: 0;
            box-sizing: border-box;
        }

        .monaco-editor-overlay.minimized .editor-header {
            border-bottom: none;
        }

        .monaco-editor-overlay .editor-content {
            flex: 1;
            overflow: visible !important;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .monaco-editor-overlay.minimized .editor-content {
            display: none;
        }

        #monaco-editor-container {
            flex: 1;
            width: 100%;
            overflow: visible !important;
            position: relative;
        }

        .editor-status-bar {
            height: 24px;
            background-color: #007acc;
            color: white;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 12px;
            font-size: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            flex-shrink: 0; /* 防止状态栏被压缩 */
            border-top: 1px solid #005a9e;
        }

        .editor-title {
            transition: color 0.2s ease;
            user-select: none;
        }

        .editor-title:hover {
            color: #007acc;
        }

        .button-container {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 2px;
            height: 100%;
        }

        .close-btn {
            background: none;
            border: none;
            color: #cccccc;
            font-size: 16px;
            cursor: pointer;
            padding: 0;
            border-radius: 3px;
            transition: background-color 0.2s;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .close-btn:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }

        .minimize-btn:hover {
            background-color: #ffaa00 !important;
            color: white !important;
        }

        .close-btn-red:hover {
            background-color: #e81123 !important;
            color: white !important;
        }

        .resizable-editor {
            resize: none;
            overflow: hidden;
            min-width: 400px;
            max-width: 80vw;
        }

        .resize-handle {
            position: absolute;
            left: 0;
            top: 0;
            width: 5px;
            height: 100%;
            background: transparent;
            cursor: col-resize;
            z-index: 10;
            transition: background-color 0.2s;
        }

        .resize-handle:hover,
        .monaco-editor-overlay:hover .resize-handle {
            background-color: #007acc;
            opacity: 0.6;
        }

        .monaco-editor-overlay.minimized .resize-handle {
            display: none;
        }

        .monaco-editor {
            width: 100% !important;
            height: 100% !important;
        }

        .monaco-editor .monaco-editor-background {
            background-color: #1e1e1e !important;
        }

        .monaco-scrollable-element > .scrollbar > .slider {
            background: rgba(121, 121, 121, 0.4) !important;
        }

        .monaco-scrollable-element > .scrollbar > .slider:hover {
            background: rgba(121, 121, 121, 0.7) !important;
        }

        @media (max-width: 1200px) {
            .monaco-editor-overlay {
                width: 70vw;
            }
        }

        @media (max-width: 768px) {
            .monaco-editor-overlay {
                width: 100vw;
                left: 0;
            }
        }
    `;
    document.head.appendChild(style);
  }

  private createResizableEditorContainer() {
    this.addEditorStyles();

    const overlay = document.createElement('div');
    overlay.className = 'monaco-editor-overlay resizable-editor';
    overlay.id = 'monaco-overlay';

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = overlay.offsetWidth;

      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    const handleResize = (e: MouseEvent) => {
      if (!isResizing) {
        return;
      }

      const deltaX = startX - e.clientX;
      const newWidth = startWidth + deltaX;
      const minWidth = 400;
      const maxWidth = window.innerWidth * 0.9;

      const constrainedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
      overlay.style.width = constrainedWidth + 'px';

      if (this.editor) {
        setTimeout(() => this.editor.layout(), 0);
      }
    };

    const stopResize = () => {
      isResizing = false;
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const header = document.createElement('div');
    header.className = 'editor-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'editor-title';

    titleSpan.addEventListener('dblclick', () => {
      if (this.isMinimized) {
        this.restore();
      }
    });

    titleSpan.addEventListener('click', () => {
      if (this.isMinimized) {
        this.restore();
      }
    });

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'close-btn minimize-btn';
    minimizeBtn.innerHTML = '−';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.onclick = () => this.toggleMinimize();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn close-btn-red';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.onclick = () => this.close();

    buttonContainer.appendChild(minimizeBtn);
    buttonContainer.appendChild(closeBtn);

    header.appendChild(titleSpan);
    header.appendChild(buttonContainer);

    const content = document.createElement('div');
    content.className = 'editor-content';

    const editorContainer = document.createElement('div');
    editorContainer.id = 'monaco-editor-container';

    const statusBar = document.createElement('div');
    statusBar.className = 'editor-status-bar';
    statusBar.innerHTML = `
      <span>Ready</span>
      <span>${this.fileName} | UTF-8</span>
    `;

    content.appendChild(editorContainer);
    content.appendChild(statusBar);

    overlay.appendChild(resizeHandle);
    overlay.appendChild(header);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    return editorContainer;
  }

  private async initMonacoEditor(
    container: HTMLElement,
    initialCode: string,
    language: string
  ): Promise<void> {
    try {
      const monaco = (window as any).monaco as typeof Monaco;
      const codeToUse = initialCode || '';
      const uri = monaco.Uri.parse(`file://${this.fileName}`);
      const oldModel = monaco.editor.getModel(uri);
      if (oldModel) {
        oldModel.dispose();
      }
      const model = monaco.editor.createModel(codeToUse, language, uri);
      await Promise.resolve();
      this.editor = monaco.editor.create(container, {
        model,
        theme: 'vs-dark',
        renderLineHighlight: 'none',
        renderLineHighlightOnlyWhenFocus: false,
        lineNumbersMinChars: 3,
        automaticLayout: true,
        fontSize: 14,
        lineHeight: 20,
        wordWrap: 'off',
        wrappingStrategy: 'simple',
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, "source-code-pro", monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        readOnly: false,
        cursorStyle: 'line',
        cursorBlinking: 'blink',
        cursorWidth: 2,
        glyphMargin: true,
        folding: false,
        foldingStrategy: 'auto',
        showFoldingControls: 'never',
        lineDecorationsWidth: 10,
        lineNumbers: 'on',
        selectOnLineNumbers: false,
        matchBrackets: 'always',
        autoIndent: 'full',
        formatOnPaste: true,
        formatOnType: true,
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        wordBasedSuggestions: 'currentDocument',
        occurrencesHighlight: 'off',
        contextmenu: true,
        mouseWheelZoom: true,
        hover: {
          enabled: true,
          delay: 300
        },
        quickSuggestions: {
          other: true,
          comments: true,
          strings: true
        },
        parameterHints: {
          enabled: true,
          cycle: true
        },
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
          useShadows: false,
          verticalHasArrows: false,
          horizontalHasArrows: false,
          verticalScrollbarSize: 14,
          horizontalScrollbarSize: 14
        }
      });
      this.editor.focus();
      // Force calculating layout
      setTimeout(() => {
        if (this.editor) {
          this.editor.layout();
        }
      }, 100);

      // Calculate layout when window size changed
      window.addEventListener('resize', () => {
        if (this.editor) {
          this.editor.layout();
        }
      });

      this.setupEditorFeatures();
      this.dirty = false;
      this.baselineVersion = model.getAlternativeVersionId();
      model.onDidChangeContent(() => {
        const dirty = model.getAlternativeVersionId() !== this.baselineVersion;
        if (dirty !== this.dirty) {
          this.dirty = dirty;
          this.updateTitle();
        }
      });
      this.updateTitle();
      console.log('Code editor initialized');
    } catch (error) {
      console.error('Code editor initialize failed:', error);
    }
  }

  private setupEditorFeatures(): void {
    if (!this.editor) {
      return;
    }

    // Ctrl+S shortcut for saving file
    this.editor.addCommand(
      (window as any).monaco.KeyMod.CtrlCmd | (window as any).monaco.KeyCode.KeyS,
      () => {
        this.saveCode();
      }
    );

    const monaco = (window as any).monaco as typeof Monaco;
    monaco.languages.registerCompletionItemProvider('javascript', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions: Monaco.languages.CompletionItem[] = [
          {
            label: 'cl',
            kind: (window as any).monaco.languages.CompletionItemKind.Snippet,
            insertText: 'console.log(${1:message});',
            insertTextRules: (window as any).monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Insert console.log',
            range: range
          },
          {
            label: 'fn',
            kind: (window as any).monaco.languages.CompletionItemKind.Snippet,
            insertText:
              'function ${1:functionName}(${2:params}) {\n\t${3:// 函数体}\n\treturn ${4:result};\n}',
            insertTextRules: (window as any).monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Create function template',
            range: range
          }
        ];

        return { suggestions };
      }
    });

    setTimeout(() => this.updateStatusBar(), 100);
  }

  private updateStatusBar(): void {
    const statusBar = document.querySelector('.editor-status-bar') as HTMLElement;
    if (!statusBar) {
      return;
    }

    let statusText = 'Ready';
    let languageInfo = 'JavaScript | UTF-8';

    if (this.editor) {
      const model = this.editor.getModel();
      const position = this.editor.getPosition();

      if (model && position) {
        const lineCount = model.getLineCount();
        const selection = this.editor.getSelection();

        statusText = `行 ${position.lineNumber}, 列 ${position.column} | 共 ${lineCount} 行`;

        if (selection && !selection.isEmpty()) {
          const selectedText = model.getValueInRange(selection);
          const lines = selectedText.split('\n').length;
          statusText += ` | 选中 ${selectedText.length} 字符${lines > 1 ? `, ${lines} 行` : ''}`;
        }

        languageInfo = `${model.getLanguageId().toUpperCase()} | UTF-8`;
      }
    }

    statusBar.innerHTML = `
      <span>${statusText}</span>
      <span>${languageInfo}</span>
    `;
  }
}
