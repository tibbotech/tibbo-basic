'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import * as fs from 'fs';

let client: LanguageClient;
let platformsPath: string | undefined = '';
const TIDEOutput = vscode.window.createOutputChannel("Tibbo");

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	TIDEOutput.show();

	const ext = vscode.extensions.getExtension("Tibbo.tibbobasic");
	let extDir = '';
	if (ext != undefined) {
		extDir = ext.extensionPath;
	}

	// const serverModule = vscode.Uri.joinPath(context.extensionUri, 'server', 'out', 'server.js').fsPath;
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	const runOptions = { execArgv: ['--stack-size=4096'] };
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009', '--stack-size=4096'] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc, options: runOptions },
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

	if (!platformsPath || !fs.existsSync(platformsPath)) {
		platformsPath = path.resolve(__dirname, '..', '..', 'platforms', 'Platforms');
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'tibbo-basic' }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
		},
		outputChannel: TIDEOutput,
		initializationOptions: {
			platformsPath: platformsPath
		}
	};

	client = new LanguageClient(
		'TibboBasic',
		serverOptions,
		clientOptions
	);

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}

	return client.stop();
}

