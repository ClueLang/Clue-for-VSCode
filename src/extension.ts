import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

let statusBarItem: vscode.StatusBarItem;

export const activate = (ctx: vscode.ExtensionContext) => {
    const serverModule = ctx.asAbsolutePath('out/server.js');
    const serverOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
    };
    const clientOptions = {
        documentSelector: [{
            scheme: 'file',
            language: 'clue',
        }],
        synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.clue') },
        outputChannelName: 'Clue Language Server',
    };
    client = new LanguageClient(
        'clue',
        'Clue Language Server',
        serverOptions,
        clientOptions,
    );
    vscode.commands.registerCommand('clue.showOutput', () => {
        client.outputChannel.show();
    });
    statusBarItem = vscode.window.createStatusBarItem();
    statusBarItem.command = 'clue.showOutput';
    statusBarItem.show();
    client.onNotification('clue/status', (message: { text: string, isError: boolean }) => {
        statusBarItem.text = message.text;
        const color = message.isError ? 'statusBarItem.errorBackground' : 'statusBarItem.background';
        statusBarItem.backgroundColor = new vscode.ThemeColor(color);
    });
    client.start();
}

export const deactivate = () => {
    statusBarItem?.dispose();
    client?.stop();
};
