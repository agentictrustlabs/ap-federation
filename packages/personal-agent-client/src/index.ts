// @ap-federation/personal-agent-client — our person's agent at THEIR door (spec 443 §1.1; Ring 0 spec 442).
export { createPersonalAgentClient, CLIENT_EXTENSIONS, type PersonalAgentClient } from './client.js';
export { discoverCompany, SUPPORTED_MAJOR, type Company, type DiscoveryResult, type DiscoveryRefusal, type PoppyDocument, type AuthServerMetadata } from './discovery.js';
export { startSession, signedInSession, signOut, sessionFetch, subjectFor, type Session, type SessionResult, type SessionDeps, type OAuthErrorCode } from './session.js';
export { directSignInStart, directSignInComplete, deviceSignInStart, deviceSignInPoll, mediatedSignIn, type DirectSignInStart, type DeviceSignInStart } from './signin.js';
export { refOf, parkedOf, readOperation, confirmOperation, cancelOperation, type PapOperation, type PapOperationState, type ConfirmOutcome, type OperationCallResult, type OperationDeps } from './operations.js';
export { clientAssertion, sessionAssertion, dpopProof, signCompactJws, b64url, b64urlDecode, sha256b64url } from './jws.js';
export type { ClientKeyPort, DpopKeyPort, VaultPort, ApprovalPort, ProofPorts, OperatorPolicy, ParkedExternalOperation, PersonalAgentClientConfig } from './ports.js';
