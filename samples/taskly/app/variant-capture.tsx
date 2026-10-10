"use client";

import { useEffect } from "react";
import { captureVariant } from "../lib/variant";

/** Renders nothing; stores the ?variant flag so it survives the /signup -> /dashboard redirect. */
export default function VariantCapture() {
  useEffect(() => captureVariant(), []);
  return null;
}
