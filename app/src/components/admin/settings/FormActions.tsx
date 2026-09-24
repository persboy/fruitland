import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";

export function FormActions(props: { saving: boolean; onCancel: () => void; saveLabel?: string; saveDisabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" size="xs" isLoading={props.saving} disabled={props.saveDisabled}>
        {!props.saving && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
        {props.saveLabel ?? "ذخیره"}
      </Button>
      <Button type="button" variant="secondary" size="xs" onClick={props.onCancel} disabled={props.saving}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        انصراف
      </Button>
    </div>
  );
}
