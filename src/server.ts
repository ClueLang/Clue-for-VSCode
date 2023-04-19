import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    DidChangeConfigurationNotification,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => {
    return {
        capabilities: {
            textDocumentSync: {
                change: TextDocumentSyncKind.Incremental,
                openClose: true,
                save: true,
            }
        }
    };
});

connection.onInitialized(() => {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

connection.onDidChangeConfiguration(() => {
    connection.console.log('Configuration changed');
    for (const document of documents.all()) {
        checkFile(document, document.uri);
    }
});

documents.onDidOpen(change => {
    connection.console.log(`File ${change.document.uri} opened`);
    checkFile(change.document, change.document.uri);
})

documents.onDidSave(change => {
    connection.console.log(`File ${change.document.uri} saved`);
    checkFile(change.document, change.document.uri);
});

const getCluePath = async () => {
    const config = await connection.workspace.getConfiguration({ section: 'clue' });
    return config['path'] || 'clue';
};

const checkFile = async (
    document: TextDocument,
    uri: string,
) => {
    const path = fileURLToPath(uri);
    const { stdout, stderr, isError } = await promisify(exec)(`${await getCluePath()} -D ${path}`).catch(e => ({ isError: true, ...e }));
    if (isError) {
        const diagnostic = parseError(document!, stderr);
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
    stderr && connection.console.log(stderr);
};

const parseError = (
    document: TextDocument,
    output: string,
) => {
    const [locationDescriptor, errorDescriptor] = output.split('\n');
    const locationDescriptorMatch = /^Error in .*:(\d+):(\d+)!$/g.exec(locationDescriptor);
    if (!locationDescriptorMatch) {
        // something else went wrong
        return null;
    }
    const [_, lineString, characterString] = locationDescriptorMatch;
    // convert to zero-indexing
    const line = Number.parseInt(lineString) - 1;
    const character = Number.parseInt(characterString) - 1;
    const errorDescriptorMatch = /^Error: "(.*)"$/g.exec(errorDescriptor);
    const message = errorDescriptorMatch?.[1] || errorDescriptor;
    const text = document.getText({
        start: {
            line,
            character,
        },
        end: {
            line,
            character: Number.POSITIVE_INFINITY,
        },
    });
    const characterEnd = (text.search(/\S/) || text.length) + character;
    return {
        range: {
            start: {
                line,
                character,
            },
            end: {
                line,
                character: characterEnd,
            },
        },
        severity: DiagnosticSeverity.Error,
        message,
    };
};

documents.listen(connection);

connection.listen();
