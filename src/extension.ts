import { workspace, ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export const activate = (ctx: ExtensionContext) => {
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
		synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.clue') },
		outputChannelName: 'Clue Language Server',
	};
	client = new LanguageClient(
		'clue',
		'Clue Language Server',
		serverOptions,
		clientOptions,
	);
	client.start();
}

export const deactivate = () => {
	if (!client) {
		return undefined;
	}
	return client.stop();
};
