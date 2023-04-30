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
    connection.console.info(`Initializing Clue Language Server`);
    workspaceFolders.push(...(params.workspaceFolders || []));
    connection.console.info(`Workspace folders: ${JSON.stringify(workspaceFolders.map(wf => fileURLToPath(wf.uri)))}`);
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
    connection.console.info('Clue Language Server initialized');
    await connection.client.register(DidChangeConfigurationNotification.type, undefined);
    await checkCluePath();
    await handleAllFiles();
});

connection.onDidChangeConfiguration(async () => {
    connection.console.info('Clue Language Server configuration changed');
    await checkCluePath();
    await handleAllFiles();
});

documents.onDidOpen(async change => {
    connection.console.info(`Opened ${fileURLToPath(change.document.uri)}`);
    await handleChangedFile(change.document);
})

documents.onDidSave(async change => {
    connection.console.info(`Saved ${fileURLToPath(change.document.uri)}`);
    await handleChangedFile(change.document);
});

const checkCluePath = async () => {
    connection.console.info('Checking Clue path');
    const config = await connection.workspace.getConfiguration({ section: 'clue' });
    const cluePath = config['path'] || 'clue';
    const command = `${cluePath} -V`;
    connection.console.info(`Running ${command}`);
    const output = await promisify(exec)(command).catch(e => ({ isError: true, ...e }));
    const versionMatch = /^clue ((\d+)\.(\d+)\.\d+(-\w+)?)$/.exec(output.stdout.trim());
    if (!versionMatch) {
        const message = 'Clue is not available. Please install it and configure the path to it in your settings.';
        connection.console.error(message);
        connection.window.showErrorMessage(message);
        isClueAvailable = false;
        return;
    }
    const [_, version, major, minor] = versionMatch || [];
    // must be Clue 3.2 or higher
    if (major !== '3' || Number.parseInt(minor) < 2) {
        const message = `Clue ${version} is not supported. Please install Clue 3.2 or higher and configure the path to it in your settings.`;
        connection.console.error(message);
        connection.window.showErrorMessage(message);
        isClueAvailable = false;
        return;
    }
    isClueAvailable = true;
    const message = `Running Clue ${version}.`;
    connection.console.info(message);
    connection.window.showInformationMessage(message);
};

const handleAllFiles = async () => {
    if (!isClueAvailable) {
        return;
    }
    connection.console.info('Checking all files');
    const workspaceFolderPaths = workspaceFolders.map(({ uri }) => fileURLToPath(uri));
    connection.console.info(`Workspace folders: ${JSON.stringify(workspaceFolderPaths)}`);
    connection.console.info(`Documents: ${JSON.stringify(documents.all().map(d => fileURLToPath(d.uri)))}`);
    const paths = [...workspaceFolderPaths];
    for (const { uri } of documents.all()) {
        const path = fileURLToPath(uri);
        if (!workspaceFolderPaths.some(wfp => path.startsWith(wfp))) {
            // document is not in a workspace
            paths.push(fileURLToPath(uri));
        }
    }
    connection.console.info(`Paths to run Clue on: ${JSON.stringify(paths)}`);
    for (const path of paths) {
        await runClue(path);
    }
};

const handleChangedFile = async (document: TextDocument) => {
    if (!isClueAvailable) {
        return;
    }
    connection.console.info(`Checking ${fileURLToPath(document.uri)}`);
    // check if document is a workspace
    const workspaceFolder = workspaceFolders.find(folder => document.uri.startsWith(folder.uri));
    if (workspaceFolder) {
        const path = fileURLToPath(workspaceFolder.uri);
        connection.console.info(`Document is in workspace: ${path}`);
        await runClue(path);
    }
    else {
        connection.console.info(`Document is not in workspace`);
        await runClue(fileURLToPath(document.uri));
    }
};

const runClue = async (path: string) => {
    const config = await connection.workspace.getConfiguration({ section: 'clue' });
    const cluePath = config['path'] || 'clue';
    const command = `${cluePath} -D ${path}`;
    connection.console.info(`Running ${command}`);
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
    if (stdout) {
        connection.console.info('Clue output:\n' + stdout);
    }
    if (stderr) {
        connection.console.info('Clue errors:\n' + stderr);
    }
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
        const message = 'Clue encountered an error. Please check the output for more information.';
        connection.console.error(message);
        connection.window.showErrorMessage(message);
        return;
    }
    connection.console.info(`Found ${errors.length} errors`);
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
    connection.console.info(`Found ${compiledFiles.length} compiled files`);
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
    connection.console.info('Sending diagnostics');
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
