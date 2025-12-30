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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { MenuItem, MenuItemSize, ModifierGroup, CreateMenuItem } from "@/lib/api";

interface ItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (item: CreateMenuItem) => void;
  item?: MenuItem | null;
  categories: string[];
  modifierGroups: ModifierGroup[];
  loading?: boolean;
}

const emptySize: MenuItemSize = { id: "", name: "", aliases: [], priceAdjustment: 0 };

export function ItemFormDialog({
  open,
  onClose,
  onSave,
  item,
  categories,
  modifierGroups,
  loading = false,
}: ItemFormDialogProps) {
  const isEdit = !!item;

  const [formData, setFormData] = useState<CreateMenuItem>({
    id: "",
    name: "",
    aliases: [],
    description: "",
    category: categories[0] || "",
    basePrice: 0,
    sizes: [],
    modifierGroups: [],
    available: true,
  });

  const [aliasInput, setAliasInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync props to form state when dialog opens - valid for controlled form dialogs
  useEffect(() => {
    if (item) {
      setFormData({
        id: item.id,
        name: item.name,
        aliases: item.aliases || [],
        description: item.description || "",
        category: item.category,
        basePrice: item.basePrice,
        sizes: item.sizes || [],
        modifierGroups: item.modifierGroups || [],
        available: item.available,
      });
    } else {
      setFormData({
        id: "",
        name: "",
        aliases: [],
        description: "",
        category: categories[0] || "",
        basePrice: 0,
        sizes: [],
        modifierGroups: [],
        available: true,
      });
    }
    setAliasInput("");
    setErrors({});
  }, [item, open, categories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    const newErrors: Record<string, string> = {};
    if (!formData.id.trim()) newErrors.id = "ID is required";
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.category) newErrors.category = "Category is required";
    if (formData.basePrice < 0) newErrors.basePrice = "Price cannot be negative";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(formData);
  };

  const addAlias = () => {
    if (aliasInput.trim() && !formData.aliases?.includes(aliasInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        aliases: [...(prev.aliases || []), aliasInput.trim()],
      }));
      setAliasInput("");
    }
  };

  const removeAlias = (alias: string) => {
    setFormData((prev) => ({
      ...prev,
      aliases: prev.aliases?.filter((a) => a !== alias) || [],
    }));
  };

  const addSize = () => {
    setFormData((prev) => ({
      ...prev,
      sizes: [...(prev.sizes || []), { ...emptySize, id: `SIZE-${Date.now()}` }],
    }));
  };

  const updateSize = (index: number, field: keyof MenuItemSize, value: string | number | string[]) => {
    setFormData((prev) => {
      const sizes = [...(prev.sizes || [])];
      sizes[index] = { ...sizes[index], [field]: value };
      return { ...prev, sizes };
    });
  };

  const removeSize = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      sizes: prev.sizes?.filter((_, i) => i !== index) || [],
    }));
  };

  const toggleModifierGroup = (groupId: string) => {
    setFormData((prev) => {
      const groups = prev.modifierGroups || [];
      if (groups.includes(groupId)) {
        return { ...prev, modifierGroups: groups.filter((g) => g !== groupId) };
      }
      return { ...prev, modifierGroups: [...groups, groupId] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Item" : "Add New Item"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="id">ID *</Label>
              <Input
                id="id"
                value={formData.id}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, id: e.target.value.toUpperCase() }))
                }
                placeholder="ITEM-ID"
                disabled={isEdit}
                className={errors.id ? "border-red-500" : ""}
              />
              {errors.id && <p className="text-xs text-red-500">{errors.id}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Item Name"
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, category: value }))}
              >
                <SelectTrigger className={errors.category ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="basePrice">Base Price ($) *</Label>
              <Input
                id="basePrice"
                type="number"
                step="0.01"
                min="0"
                value={formData.basePrice}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, basePrice: parseFloat(e.target.value) || 0 }))
                }
                className={errors.basePrice ? "border-red-500" : ""}
              />
              {errors.basePrice && <p className="text-xs text-red-500">{errors.basePrice}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={formData.description || ""}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Item description"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="available"
              checked={formData.available}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, available: checked }))
              }
            />
            <Label htmlFor="available">Available</Label>
          </div>

          <Separator />

          {/* Aliases */}
          <div className="space-y-2">
            <Label>Aliases (for voice recognition)</Label>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Add alias"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addAlias}>
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {formData.aliases?.map((alias) => (
                <Badge key={alias} variant="secondary" className="cursor-pointer" onClick={() => removeAlias(alias)}>
                  {alias} &times;
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Sizes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sizes (optional)</Label>
              <Button type="button" variant="outline" size="sm" onClick={addSize}>
                Add Size
              </Button>
            </div>
            {formData.sizes && formData.sizes.length > 0 && (
              <div className="space-y-2">
                {formData.sizes.map((size, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <Input
                      placeholder="Size ID"
                      value={size.id}
                      onChange={(e) => updateSize(index, "id", e.target.value.toUpperCase())}
                      className="w-32"
                    />
                    <Input
                      placeholder="Name"
                      value={size.name}
                      onChange={(e) => updateSize(index, "name", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="+ Price"
                      value={size.priceAdjustment}
                      onChange={(e) => updateSize(index, "priceAdjustment", parseFloat(e.target.value) || 0)}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSize(index)}
                    >
                      &times;
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Modifier Groups */}
          <div className="space-y-2">
            <Label>Modifier Groups</Label>
            <div className="flex flex-wrap gap-2">
              {modifierGroups.map((group) => {
                const isSelected = formData.modifierGroups?.includes(group.id);
                return (
                  <Button
                    key={group.id}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleModifierGroup(group.id)}
                  >
                    {group.name}
                  </Button>
                );
              })}
            </div>
            {modifierGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">No modifier groups available</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
