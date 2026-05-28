import { Fragment } from "react";

export const getLayout = (RawImport) =>
  typeof RawImport.Layout === "function"
    ? RawImport.Layout
    : typeof RawImport.getGlobalProvider === "function"
      ? RawImport.getGlobalProvider()
      : Fragment;
