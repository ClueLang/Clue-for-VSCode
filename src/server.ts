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

let isClueAvailable: boolean = false;

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
    await checkCluePath();
    await handleAllFiles();
});

connection.onDidChangeConfiguration(async () => {
    await checkCluePath();
    await handleAllFiles();
});

documents.onDidOpen(async change => {
    await handleChangedFile(change.document);
})

documents.onDidSave(async change => {
    await handleChangedFile(change.document);
});

const checkCluePath = async () => {
    const config = await connection.workspace.getConfiguration({ section: 'clue' });
    const cluePath = config['path'] || 'clue';
    const command = `${cluePath} -V`;
    const output = await promisify(exec)(command).catch(e => ({ isError: true, ...e }));
    const versionMatch = /^clue ((\d+)\.(\d+)\.\d+(-\w+)?)$/.exec(output.stdout.trim());
    if (!versionMatch) {
        connection.window.showErrorMessage('Clue is not available. Please install it and configure the path to it in your settings.');
        isClueAvailable = false;
        return;
    }
    const [_, version, major, minor] = versionMatch || [];
    // must be Clue 3.2 or higher
    if (major !== '3' || Number.parseInt(minor) < 2) {
        connection.window.showErrorMessage(`Clue ${version} is not supported. Please install Clue 3.2 or higher and configure the path to it in your settings.`);
        isClueAvailable = false;
        return;
    }
    isClueAvailable = true;
    connection.window.showInformationMessage(`Running Clue ${version}.`);
};

const handleAllFiles = async () => {
    if (!isClueAvailable) {
        return;
    }
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
    if (!isClueAvailable) {
        return;
    }
    // check if document is a workspace
    const workspaceFolder = workspaceFolders.find(folder => document.uri.startsWith(folder.uri));
    await runClue(fileURLToPath((workspaceFolder || document).uri));
};

const runClue = async (path: string) => {
    const config = await connection.workspace.getConfiguration({ section: 'clue' });
    const cluePath = config['path'] || 'clue';
    const command = `${cluePath} -D ${path}`;
    const env: { [key: string]: string } = { };
    for (const [key, value] of Object.entries(config['env'] || { })) {
        if (typeof value === 'object') {
            env[key] = JSON.stringify(value);
        }
        else {
            env[key] = String(value);
        }
    }
    const output = await promisify(exec)(command, { env }).catch(e => ({ isError: true, ...e }));
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
        connection.window.showErrorMessage('Clue encountered an error. Please check the output for more information.');
        return;
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
        const whitespaceIndex = text.search(/\s/);
        const characterEnd = (whitespaceIndex === -1 ? text.length : whitespaceIndex) + character;
        diagnosticsByUri[uri].push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line, character },
                end: { line, character: characterEnd },
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
