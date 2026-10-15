// The few Ring 0 helpers the setup ceremony needs from packages the holder library does not already import — kept in one
// place so the setup script reads as the ceremony it is.
export { computeFacetHash, generateHolderSecret, type IssuerKeyFacetV1, type SignedIssuerKeyFacetV1 } from '@agenticprimitives/privacy-credentials';
export { credentialDigestOf as credentialDigestOfJwt } from '@agenticprimitives/estate-projection';
