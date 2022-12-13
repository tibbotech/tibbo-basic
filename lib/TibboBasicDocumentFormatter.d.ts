import { TextDocument, DocumentFormattingParams, TextEdit } from 'vscode-languageserver';
export default class TibboBasicDocumentFormatter {
    formatDocument(document: TextDocument, formatParams: DocumentFormattingParams): Thenable<TextEdit[]>;
}
