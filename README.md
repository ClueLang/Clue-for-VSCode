# Clue for VSCode

A Visual Studio Code extension for the Clue programming language.

## Features

- Adds syntax highlighting for Clue.
- Shows compiler errors in the editor.
- Allows configuration of environmental variables.

## Contributing

You will need to have Visual Studio Code, [Clue](https://github.com/ClueLang/Clue), and NPM installed.

1. Clone or download this repository.
4. Open this directory in Visual Studio Code.
2. Run `npm install` in the terminal.
3. Run `npm run compile` to build the extension.
5. Open `./src/extension.ts`.
6. Press F5 to run the extension.

## Usage

The extension will activate when opening any file with a `.clue` extension. The Clue compiler will be run on files whenever they are opened or saved.

When using the extension for the first time, you will need to set the path to the Clue executable. This can be found in the extension settings.

Environmental variables can be set in the `settings.json`.
