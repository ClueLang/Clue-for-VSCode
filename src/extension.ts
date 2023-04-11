import * as vscode from 'vscode';

export const activate = (ctx: vscode.ExtensionContext) => {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "clue" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('clue.helloWorld', () => {
		vscode.window.showErrorMessage('Hello World from clue!');
	});

	ctx.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
