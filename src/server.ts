import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	DidChangeConfigurationNotification,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize(() => {
	return { capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental } };
});

connection.onInitialized(() => {
	connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

connection.onDidOpenTextDocument(async params => {
	await checkFile(params.textDocument.uri);
});

connection.onDidSaveTextDocument(async params => {
    await checkFile(params.textDocument.uri);
});

const getCluePath = async () => {
	const config = await connection.workspace.getConfiguration({ section: 'clue' });
	return config['path'] || 'clue';
};

const checkFile = async (uri: string) => {
	const path = fileURLToPath(uri);
	const { stdout, stderr, isError } = await promisify(exec)(`${await getCluePath()} ${path}`).catch(e => ({ isError: true, ...e }));
	if (isError) {
		const diagnostic = parseError(stderr);
		if (!diagnostic) {
			throw new Error(stderr);
		}
		connection.sendDiagnostics({
			uri,
			diagnostics: [diagnostic],
		});
	}
	else {
		connection.sendDiagnostics({ uri, diagnostics: [] });
	}
	stdout && connection.console.log(stdout);
	stderr && connection.console.error(stderr);
};

const parseError = (output: string) => {
	const [locationDescriptor, errorDescriptor] = output.split('\n');
	const locationDescriptorMatch = /^Error in .*:(\d+):(\d+)!$/g.exec(locationDescriptor);
	if (!locationDescriptorMatch) {
		// something else went wrong
		return null;
	}
	const [_, lineString, characterString] = locationDescriptorMatch;
	const line = Number.parseInt(lineString);
	const character = Number.parseInt(characterString);
	const errorDescriptorMatch = /^Error: "(.*)"$/g.exec(errorDescriptor);
	const message = errorDescriptorMatch?.[1] || errorDescriptor;
	return {
		range: {
			start: {
				line: line - 1,
				character: character - 1,
			},
			end: {
				line: line - 1,
				character: character - 1,
			},
		},
		severity: DiagnosticSeverity.Error,
		message,
	};
};

connection.listen();
