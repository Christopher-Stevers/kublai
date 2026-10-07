import { documentActor, type DocumentAccess } from "./access";
import {
  registerEditorSaveReceipt,
  readEditorSaveReceipt,
} from "./editor-save-receipt";
import { mutateWorkspace, readWorkspace } from "./service";
import { editorDocument } from "./wopi";

export function registerDocumentEditorSave(
  access: DocumentAccess,
  documentId: string,
  requestId: string,
) {
  return mutateWorkspace(access.user.id, access.job.id, (state, actor) => {
    editorDocument(state, actor, documentId, true);
    return registerEditorSaveReceipt(state, actor, documentId, requestId);
  });
}
export async function documentEditorSaveStatus(
  access: DocumentAccess,
  documentId: string,
  requestId: string,
) {
  return readEditorSaveReceipt(
    await readWorkspace(access),
    documentActor(access, []),
    documentId,
    requestId,
  );
}
