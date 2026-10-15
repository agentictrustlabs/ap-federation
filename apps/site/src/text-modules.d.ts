declare module '*.yaml' {
  const text: string;
  export default text;
}

/** The CVM's attestation JWT, bundled as text (spec 440 A5 step 4). */
declare module '*.jwt' {
  const content: string;
  export default content;
}
