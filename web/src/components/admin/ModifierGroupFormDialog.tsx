/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { ModifierGroup, Modifier, CreateModifierGroup } from "@/lib/api";

interface ModifierGroupFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (group: CreateModifierGroup) => void;
  group?: ModifierGroup | null;
  loading?: boolean;
}

const emptyModifier: Modifier = { id: "", name: "", aliases: [], price: 0 };

export function ModifierGroupFormDialog({
  open,
  onClose,
  onSave,
  group,
  loading = false,
}: ModifierGroupFormDialogProps) {
  const isEdit = !!group;

  const [formData, setFormData] = useState<CreateModifierGroup>({
    id: "",
    name: "",
    required: false,
    minSelections: 0,
    maxSelections: 1,
    modifiers: [],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync props to form state when dialog opens - valid for controlled form dialogs
  useEffect(() => {
    if (group) {
      setFormData({
        id: group.id,
        name: group.name,
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        modifiers: group.modifiers,
      });
    } else {
      setFormData({
        id: "",
        name: "",
        required: false,
        minSelections: 0,
        maxSelections: 1,
        modifiers: [],
      });
    }
    setErrors({});
  }, [group, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.id.trim()) newErrors.id = "ID is required";
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (formData.modifiers.length === 0) newErrors.modifiers = "At least one modifier is required";

    // Validate each modifier
    formData.modifiers.forEach((mod, i) => {
      if (!mod.id.trim()) newErrors[`modifier_${i}_id`] = "Modifier ID required";
      if (!mod.name.trim()) newErrors[`modifier_${i}_name`] = "Modifier name required";
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(formData);
  };

  const addModifier = () => {
    setFormData((prev) => ({
      ...prev,
      modifiers: [...prev.modifiers, { ...emptyModifier, id: `MOD-${Date.now()}` }],
    }));
  };

  const updateModifier = (index: number, field: keyof Modifier, value: string | number | string[]) => {
    setFormData((prev) => {
      const modifiers = [...prev.modifiers];
      modifiers[index] = { ...modifiers[index], [field]: value };
      return { ...prev, modifiers };
    });
  };

  const removeModifier = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      modifiers: prev.modifiers.filter((_, i) => i !== index),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Modifier Group" : "Add Modifier Group"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="groupId">ID *</Label>
              <Input
                id="groupId"
                value={formData.id}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, id: e.target.value.toUpperCase() }))
                }
                placeholder="GROUP-ID"
                disabled={isEdit}
                className={errors.id ? "border-red-500" : ""}
              />
              {errors.id && <p className="text-xs text-red-500">{errors.id}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupName">Name *</Label>
              <Input
                id="groupName"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Group Name"
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="required"
                checked={formData.required}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, required: checked }))
                }
              />
              <Label htmlFor="required">Required</Label>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="minSelections">Min:</Label>
              <Input
                id="minSelections"
                type="number"
                min="0"
                value={formData.minSelections}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    minSelections: parseInt(e.target.value) || 0,
                  }))
                }
                className="w-20"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="maxSelections">Max:</Label>
              <Input
                id="maxSelections"
                type="number"
                min="1"
                value={formData.maxSelections}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    maxSelections: parseInt(e.target.value) || 1,
                  }))
                }
                className="w-20"
              />
            </div>
          </div>

          <Separator />

          {/* Modifiers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Modifiers *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addModifier}>
                Add Modifier
              </Button>
            </div>
            {errors.modifiers && <p className="text-xs text-red-500">{errors.modifiers}</p>}

            {formData.modifiers.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_2fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                  <span>ID</span>
                  <span>Name</span>
                  <span>Price</span>
                  <span></span>
                </div>
                {formData.modifiers.map((mod, index) => (
                  <div key={index} className="grid grid-cols-[1fr_2fr_1fr_auto] gap-2 items-center">
                    <Input
                      placeholder="ID"
                      value={mod.id}
                      onChange={(e) => updateModifier(index, "id", e.target.value.toUpperCase())}
                      className={errors[`modifier_${index}_id`] ? "border-red-500" : ""}
                    />
                    <Input
                      placeholder="Name"
                      value={mod.name}
                      onChange={(e) => updateModifier(index, "name", e.target.value)}
                      className={errors[`modifier_${index}_name`] ? "border-red-500" : ""}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={mod.price}
                      onChange={(e) =>
                        updateModifier(index, "price", parseFloat(e.target.value) || 0)
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeModifier(index)}
                    >
                      &times;
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
