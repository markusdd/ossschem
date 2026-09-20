/**
 * VS Code host for @ossschem/ui. PR 17 skeleton: command ossschem.open
 * reads a .ir.json, posts it into a webview. Elk worker is loaded via
 * asWebviewUri once the webview bundle exists.
 */
type Disposable = { dispose(): void };

interface ExtensionContext {
  subscriptions: Disposable[];
  extensionUri: { fsPath: string };
}

interface TextDocument {
  fileName: string;
  getText(): string;
}

const vscode = {
  window: {
    activeTextEditor: undefined as { document: TextDocument } | undefined,
    showErrorMessage: (m: string) => m,
    createWebviewPanel: (
      _viewType: string,
      title: string,
      _col: number,
      _opts: object,
    ): { webview: { html: string } } => ({
      webview: {
        html: `<!doctype html><html><body><p>${title}</p><p>Load @ossschem/ui here.</p></body></html>`,
      },
    }),
  },
  commands: {
    registerCommand: (id: string, fn: () => void): Disposable => {
      void id;
      void fn;
      return { dispose() {} };
    },
  },
  ViewColumn: { One: 1 },
};

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ossschem.open", () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc === undefined || !doc.fileName.endsWith(".ir.json")) {
        vscode.window.showErrorMessage("Open a .ir.json file first");
        return;
      }
      const panel = vscode.window.createWebviewPanel("ossschem", "ossschem", vscode.ViewColumn.One, {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      });
      panel.webview.html = `<!doctype html><html><body>
        <div id="root">ossschem webview — IR ${doc.fileName}</div>
      </body></html>`;
    }),
  );
}

export function deactivate(): void {}
