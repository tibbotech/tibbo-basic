'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { workspace } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 * Please note: the test suite only supports 'external' mode.
 */
let client: LanguageClient;
let platformsPath: string | undefined = '';
const TIDEOutput = vscode.window.createOutputChannel("TIDE");

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	TIDEOutput.show();

	const ext = vscode.extensions.getExtension("Tibbo.tibbobasic");
	let extDir = '';
	if (ext != undefined) {
		extDir = ext.extensionPath;
	}

	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	platformsPath = vscode.workspace.getConfiguration().get('tide.platformsPath');
	if (platformsPath == '') {
		platformsPath = path.join(extDir, 'Platforms');
	}

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'tibbo-basic' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		},
		outputChannel: TIDEOutput,
		initializationOptions: {
			platformsPath: platformsPath
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'TIDE',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}

	return client.stop();
}

