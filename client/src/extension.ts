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

let client: LanguageClient;
let platformsPath: string | undefined = '';
const TIDEOutput = vscode.window.createOutputChannel("Tibbo Basic");

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	TIDEOutput.show();

	const ext = vscode.extensions.getExtension("Tibbo.tibbobasic");
	let extDir = '';
	if (ext != undefined) {
		extDir = ext.extensionPath;
	}

	let serverPath = path.join('server', 'out', 'server.js');
	if (process.env.NODE_ENV == 'production') {
		serverPath = path.join('out', 'server.js');
	}
	const serverModule = context.asAbsolutePath(serverPath);
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

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

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'tibbo-basic' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
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

