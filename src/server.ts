import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    DidChangeConfigurationNotification,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { exec } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { promisify } from 'util';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, WorkspaceFolder } from 'vscode-languageserver-types';
import * as fs from 'fs/promises';

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

const workspaceFolders: WorkspaceFolder[] = [];

connection.onInitialize(params => {
    workspaceFolders.push(...(params.workspaceFolders || []));
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

connection.onInitialized(async () => {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
    await handleAllFiles();
});

connection.onDidChangeConfiguration(async () => {
    await handleAllFiles();
});

documents.onDidOpen(async change => {
    await handleChangedFile(change.document);
})

documents.onDidSave(async change => {
    await handleChangedFile(change.document);
});

const handleAllFiles = async () => {
    const paths = workspaceFolders.map(({ uri }) => fileURLToPath(uri));
    for (const { uri } of documents.all()) {
        if (!paths.some(path => uri.startsWith(path))) {
            paths.push(fileURLToPath(uri));
        }
    }
    for (const path of paths) {
        await runClue(path);
    }
};

const handleChangedFile = async (document: TextDocument) => {
    // check if document is a workspace
    const workspaceFolder = workspaceFolders.find(folder => document.uri.startsWith(folder.uri));
    await runClue(fileURLToPath((workspaceFolder || document).uri));
};

const runClue = async (path: string) => {
    const cluePath = (await connection.workspace.getConfiguration({ section: 'clue' }))['path'] || 'clue';
    const output = await promisify(exec)(`${cluePath} -D ${path}`).catch(e => ({ isError: true, ...e }));
    const { stdout, stderr, isError } = output;
    stdout && connection.console.log(stdout);
    stderr && connection.console.log(stderr);
    const emptyError = () => ({
        path: '',
        line: 0,
        character: 0,
        message: '',
    });
    // collect errors from stderr
    const errors: ReturnType<typeof emptyError>[] = [];
    let currentError = emptyError();
    const lines = stderr.split('\n');
    let expectingMessage = false;
    for (const line of lines) {
        if (!expectingMessage) {
            const locationDescriptorMatch = /^Error in (.*):(\d+):(\d+)!$/g.exec(line);
            if (!locationDescriptorMatch) {
                continue;
            }
            const [_, path, lineString, characterString] = locationDescriptorMatch;
            currentError.path = path;
            currentError.line = Number.parseInt(lineString) - 1;
            currentError.character = Number.parseInt(characterString) - 1;
            expectingMessage = true;
            continue;
        }
        currentError.message = line;
        errors.push(currentError);
        currentError = emptyError();
        expectingMessage = false;
    }
    if (isError && errors.length === 0) {
        // something else went wrong
        throw new Error(stderr);
    }
    // collect successfully compiled files from stdout
    const compiledFiles: string[] = [];
    for (const line of stdout.split('\n')) {
        const compiledFileMatch = /^Compiled file "(.*)" in .*!$/g.exec(line);
        if (!compiledFileMatch) {
            continue;
        }
        const [_, path] = compiledFileMatch;
        compiledFiles.push(path);
    }
    // need to find the end of each error
    const documentsCache: { [path: string]: TextDocument } = { };
    const getLine = async (
        path: string,
        line: number,
        startCharacter: number,
    ) => {
        const uri = pathToFileURL(path).toString();
        if (!documentsCache[uri]) {
            const documentMaybe = documents.get(uri);
            if (documentMaybe) {
                documentsCache[uri] = documentMaybe;
            }
            else {
                const text = await fs.readFile(path, 'utf8');
                documentsCache[uri] = TextDocument.create(uri, 'clue', 1, text);
            }
        }
        return documentsCache[uri].getText({
            start: { line, character: startCharacter },
            end: { line, character: Number.POSITIVE_INFINITY },
        });
    };
    const diagnosticsByUri: { [uri: string]: Diagnostic[] } = { };
    for (const error of errors) {
        const { path, line, character, message } = error;
        const uri = pathToFileURL(path).toString();
        if (!diagnosticsByUri[uri]) {
            diagnosticsByUri[uri] = [];
        }
        const text = await getLine(path, line, character);
        diagnosticsByUri[uri].push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line, character },
                end: { line, character: (text.search(/\S/) || text.length) + character },
            },
            message,
            source: 'clue',
        });
    }
    // send diagnostics for files with errors
    for (const [uri, diagnostics] of Object.entries(diagnosticsByUri)) {
        connection.sendDiagnostics({ uri, diagnostics });
    }
    // clear diagnostics for files without errors
    for (const path of compiledFiles) {
        const uri = pathToFileURL(path).toString();
        connection.sendDiagnostics({ uri, diagnostics: [] });
    }
};

documents.listen(connection);

connection.listen();
