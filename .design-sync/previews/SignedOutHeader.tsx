import { SignedOutHeader } from "@infiniroot/shared";
import { PreviewRouter } from "../../shared/previewProviders";

export function Draft() {
  return (
    <PreviewRouter>
      <SignedOutHeader wordmark="draft" />
    </PreviewRouter>
  );
}

export function Faab() {
  return (
    <PreviewRouter>
      <SignedOutHeader wordmark="faab" />
    </PreviewRouter>
  );
}

export function League() {
  return (
    <PreviewRouter>
      <SignedOutHeader wordmark="league" />
    </PreviewRouter>
  );
}
