import * as ts from "../../_namespaces/ts";
import {
    createServerHost,
    File,
    libFile,
} from "../virtualFileSystemWithWatch";
import {
    baselineTsserverLogs,
    checkNumberOfProjects,
    checkProjectActualFiles,
    closeFilesForSession,
    createLoggerWithInMemoryLogs,
    createSession,
    openFilesForSession,
    protocolFileLocationFromSubstring,
    TestSession,
    TestSessionRequest,
} from "./helpers";

describe("unittests:: tsserver:: Semantic operations on Syntax server", () => {
    function setup() {
        const file1: File = {
            path: `/user/username/projects/myproject/a.ts`,
            content: `import { y, cc } from "./b";
import { something } from "something";
class c { prop = "hello"; foo() { return this.prop; } }`
        };
        const file2: File = {
            path: `/user/username/projects/myproject/b.ts`,
            content: `export { cc } from "./c";
import { something } from "something";
                export const y = 10;`
        };
        const file3: File = {
            path: `/user/username/projects/myproject/c.ts`,
            content: `export const cc = 10;`
        };
        const something: File = {
            path: `/user/username/projects/myproject/node_modules/something/index.d.ts`,
            content: "export const something = 10;"
        };
        const configFile: File = {
            path: `/user/username/projects/myproject/tsconfig.json`,
            content: "{}"
        };
        const host = createServerHost([file1, file2, file3, something, libFile, configFile]);
        const session = createSession(host, { syntaxOnly: true, useSingleInferredProject: true, logger: createLoggerWithInMemoryLogs(host) });
        return { host, session, file1, file2, file3, something, configFile };
    }

    function verifySessionException<T extends ts.server.protocol.Request>(session: TestSession, request: TestSessionRequest<T>) {
        try {
            session.executeCommandSeq(request);
        }
        catch (e) {
            session.logger.info(e.message);
        }
    }

    it("open files are added to inferred project even if config file is present and semantic operations fail", () => {
        const { session, file1, file2, file3, something } = setup();
        openFilesForSession([file1], session);
        verifyCompletions();
        verifyGoToDefToB();

        openFilesForSession([file2], session);
        verifyCompletions();
        verifyGoToDefToB();
        verifyGoToDefToC();

        openFilesForSession([file3], session);
        openFilesForSession([something], session);

        // Close open files and verify resolutions
        closeFilesForSession([file3], session);
        closeFilesForSession([file2], session);

        baselineTsserverLogs("syntacticServer", "files go to inferred project and semantic operations fail", session);

        function verifyCompletions() {
            verifySessionException<ts.server.protocol.CompletionsRequest>(session, {
                command: ts.server.protocol.CommandTypes.Completions,
                arguments: protocolFileLocationFromSubstring(file1, "prop", { index: 1 })
            });
        }

        function verifyGoToDefToB() {
            verifySessionException<ts.server.protocol.DefinitionAndBoundSpanRequest>(session, {
                command: ts.server.protocol.CommandTypes.DefinitionAndBoundSpan,
                arguments: protocolFileLocationFromSubstring(file1, "y")
            });
        }

        function verifyGoToDefToC() {
            verifySessionException<ts.server.protocol.DefinitionAndBoundSpanRequest>(session, {
                command: ts.server.protocol.CommandTypes.DefinitionAndBoundSpan,
                arguments: protocolFileLocationFromSubstring(file1, "cc")
            });
        }
    });

    it("throws on unsupported commands", () => {
        const { session, file1 } = setup();
        const service = session.getProjectService();
        openFilesForSession([file1], session);
        verifySessionException<ts.server.protocol.SemanticDiagnosticsSyncRequest>(session, {
            command: ts.server.protocol.CommandTypes.SemanticDiagnosticsSync,
            arguments: { file: file1.path }
        });

        const project = service.inferredProjects[0];
        try {
            project.getLanguageService().getSemanticDiagnostics(file1.path);
        }
        catch (e) {
            session.logger.info(e.message);
        }
        baselineTsserverLogs("syntacticServer", "throws on unsupported commands", session);
    });

    it("should not include auto type reference directives", () => {
        const { host, session, file1 } = setup();
        const atTypes: File = {
            path: `/node_modules/@types/somemodule/index.d.ts`,
            content: "export const something = 10;"
        };
        host.ensureFileOrFolder(atTypes);
        openFilesForSession([file1], session);
        baselineTsserverLogs("syntacticServer", "should not include auto type reference directives", session);
    });

    it("should not include referenced files from unopened files", () => {
        const file1: File = {
            path: `/user/username/projects/myproject/a.ts`,
            content: `///<reference path="b.ts"/>
///<reference path="/user/username/projects/myproject/node_modules/something/index.d.ts"/>
function fooA() { }`
        };
        const file2: File = {
            path: `/user/username/projects/myproject/b.ts`,
            content: `///<reference path="./c.ts"/>
///<reference path="/user/username/projects/myproject/node_modules/something/index.d.ts"/>
function fooB() { }`
        };
        const file3: File = {
            path: `/user/username/projects/myproject/c.ts`,
            content: `function fooC() { }`
        };
        const something: File = {
            path: `/user/username/projects/myproject/node_modules/something/index.d.ts`,
            content: "function something() {}"
        };
        const configFile: File = {
            path: `/user/username/projects/myproject/tsconfig.json`,
            content: "{}"
        };
        const host = createServerHost([file1, file2, file3, something, libFile, configFile]);
        const session = createSession(host, { syntaxOnly: true, useSingleInferredProject: true });
        const service = session.getProjectService();
        openFilesForSession([file1], session);
        checkNumberOfProjects(service, { inferredProjects: 1 });
        const project = service.inferredProjects[0];
        checkProjectActualFiles(project, ts.emptyArray);

        openFilesForSession([file2], session);
        checkNumberOfProjects(service, { inferredProjects: 1 });
        assert.isFalse(project.dirty);
        project.updateGraph();
        checkProjectActualFiles(project, ts.emptyArray);

        closeFilesForSession([file2], session);
        checkNumberOfProjects(service, { inferredProjects: 1 });
        assert.isTrue(project.dirty);
        checkProjectActualFiles(project, ts.emptyArray);
    });
});
