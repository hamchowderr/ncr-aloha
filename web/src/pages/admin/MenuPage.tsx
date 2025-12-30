import { useState, useMemo } from "react";
import {
  useAdminMenu,
  useMenuItemMutations,
  useCategoryMutations,
  useModifierGroupMutations,
} from "@/hooks/useAdminMenu";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItemFormDialog } from "@/components/admin/ItemFormDialog";
import { CategoryFormDialog } from "@/components/admin/CategoryFormDialog";
import { ModifierGroupFormDialog } from "@/components/admin/ModifierGroupFormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import type { MenuItem, ModifierGroup, CreateMenuItem, CreateModifierGroup } from "@/lib/api";

export function MenuPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const { items, menu, loading, error, refetch } = useAdminMenu();

  // Mutations
  const { createItem, updateItem, deleteItem, toggleAvailability } = useMenuItemMutations();
  const { createCategory, renameCategory, deleteCategory } = useCategoryMutations();
  const { createModifierGroup, updateModifierGroup, deleteModifierGroup } = useModifierGroupMutations();

  // Dialog states
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [modifierGroupDialogOpen, setModifierGroupDialogOpen] = useState(false);
  const [editingModifierGroup, setEditingModifierGroup] = useState<ModifierGroup | null>(null);

  // Confirm dialog states
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  // Get unique categories and modifier groups
  const categories = useMemo(() => menu?.categories ?? [], [menu]);
  const modifierGroups = useMemo(() => menu?.modifierGroups ?? [], [menu]);

  // Filter items by search and category
  const filteredItems = useMemo(() => {
    if (!items) return null;
    return items.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (search) {
        const searchLower = search.toLowerCase();
        return (
          item.id.toLowerCase().includes(searchLower) ||
          item.name.toLowerCase().includes(searchLower) ||
          item.category.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [items, search, categoryFilter]);

  // Handlers
  const handleSaveItem = async (itemData: CreateMenuItem) => {
    try {
      if (editingItem) {
        await updateItem.mutateAsync({ itemId: editingItem.id, data: itemData });
      } else {
        await createItem.mutateAsync(itemData);
      }
      setItemDialogOpen(false);
      setEditingItem(null);
    } catch (err) {
      console.error("Failed to save item:", err);
    }
  };

  const handleDeleteItem = (item: MenuItem) => {
    setConfirmDialog({
      open: true,
      title: "Delete Item",
      description: `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await deleteItem.mutateAsync(item.id);
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        } catch (err) {
          console.error("Failed to delete item:", err);
        }
      },
    });
  };

  const handleToggleAvailability = async (item: MenuItem) => {
    try {
      await toggleAvailability.mutateAsync({ itemId: item.id, available: !item.available });
    } catch (err) {
      console.error("Failed to toggle availability:", err);
    }
  };

  const handleSaveCategory = async (name: string) => {
    try {
      if (editingCategory) {
        await renameCategory.mutateAsync({ oldName: editingCategory, newName: name });
      } else {
        await createCategory.mutateAsync(name);
      }
      setCategoryDialogOpen(false);
      setEditingCategory(null);
    } catch (err) {
      console.error("Failed to save category:", err);
    }
  };

  const handleDeleteCategory = (categoryName: string) => {
    const itemCount = items?.filter((i) => i.category === categoryName).length ?? 0;
    setConfirmDialog({
      open: true,
      title: "Delete Category",
      description:
        itemCount > 0
          ? `Cannot delete "${categoryName}" because ${itemCount} item(s) use this category.`
          : `Are you sure you want to delete "${categoryName}"?`,
      onConfirm: async () => {
        if (itemCount > 0) {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          return;
        }
        try {
          await deleteCategory.mutateAsync(categoryName);
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        } catch (err) {
          console.error("Failed to delete category:", err);
        }
      },
    });
  };

  const handleSaveModifierGroup = async (groupData: CreateModifierGroup) => {
    try {
      if (editingModifierGroup) {
        await updateModifierGroup.mutateAsync({ groupId: editingModifierGroup.id, data: groupData });
      } else {
        await createModifierGroup.mutateAsync(groupData);
      }
      setModifierGroupDialogOpen(false);
      setEditingModifierGroup(null);
    } catch (err) {
      console.error("Failed to save modifier group:", err);
    }
  };

  const handleDeleteModifierGroup = (group: ModifierGroup) => {
    const itemCount = items?.filter((i) => i.modifierGroups?.includes(group.id)).length ?? 0;
    setConfirmDialog({
      open: true,
      title: "Delete Modifier Group",
      description:
        itemCount > 0
          ? `Cannot delete "${group.name}" because ${itemCount} item(s) use this modifier group.`
          : `Are you sure you want to delete "${group.name}"?`,
      onConfirm: async () => {
        if (itemCount > 0) {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          return;
        }
        try {
          await deleteModifierGroup.mutateAsync(group.id);
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        } catch (err) {
          console.error("Failed to delete modifier group:", err);
        }
      },
    });
  };

  // Track mutation state for potential UI feedback
  const _isMutating =
    createItem.isPending ||
    updateItem.isPending ||
    deleteItem.isPending ||
    createCategory.isPending ||
    renameCategory.isPending ||
    deleteCategory.isPending ||
    createModifierGroup.isPending ||
    updateModifierGroup.isPending ||
    deleteModifierGroup.isPending;
  void _isMutating; // Suppress unused warning - available for future use

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Menu Management</h1>
        <Button onClick={() => refetch()} variant="outline" disabled={loading}>
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="items">
        <TabsList className="mb-4">
          <TabsTrigger value="items">Items ({items?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="categories">Categories ({categories.length})</TabsTrigger>
          <TabsTrigger value="modifiers">Modifier Groups ({modifierGroups.length})</TabsTrigger>
        </TabsList>

        {/* Items Tab */}
        <TabsContent value="items">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle>Menu Items</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Search items..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-64"
                  />
                  <Button
                    onClick={() => {
                      setEditingItem(null);
                      setItemDialogOpen(true);
                    }}
                  >
                    + Add Item
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(10)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-destructive mb-2">Failed to load menu items</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              ) : filteredItems && filteredItems.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Base Price</TableHead>
                      <TableHead>Sizes</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.id}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${item.basePrice.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {item.sizes && item.sizes.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {item.sizes.map((size) => (
                                <Badge key={size.id} variant="secondary" className="text-xs">
                                  {size.name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={item.available}
                            onCheckedChange={() => handleToggleAvailability(item)}
                            disabled={toggleAvailability.isPending}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                ...
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingItem(item);
                                  setItemDialogOpen(true);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteItem(item)}
                                className="text-destructive"
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-2">No menu items found</p>
                  <Button
                    onClick={() => {
                      setEditingItem(null);
                      setItemDialogOpen(true);
                    }}
                  >
                    Add Your First Item
                  </Button>
                </div>
              )}

              {filteredItems && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Showing {filteredItems.length} of {items?.length ?? 0} items
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Categories</CardTitle>
                <Button
                  onClick={() => {
                    setEditingCategory(null);
                    setCategoryDialogOpen(true);
                  }}
                >
                  + Add Category
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : categories.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category Name</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((cat) => {
                      const itemCount = items?.filter((i) => i.category === cat).length ?? 0;
                      return (
                        <TableRow key={cat}>
                          <TableCell className="font-medium">{cat}</TableCell>
                          <TableCell className="text-right">{itemCount}</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  ...
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingCategory(cat);
                                    setCategoryDialogOpen(true);
                                  }}
                                >
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteCategory(cat)}
                                  className="text-destructive"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-2">No categories found</p>
                  <Button
                    onClick={() => {
                      setEditingCategory(null);
                      setCategoryDialogOpen(true);
                    }}
                  >
                    Add Your First Category
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Modifier Groups Tab */}
        <TabsContent value="modifiers">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Modifier Groups</CardTitle>
                <Button
                  onClick={() => {
                    setEditingModifierGroup(null);
                    setModifierGroupDialogOpen(true);
                  }}
                >
                  + Add Modifier Group
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : modifierGroups.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead className="text-right">Modifiers</TableHead>
                      <TableHead className="text-right">Used By</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modifierGroups.map((group) => {
                      const usedByCount =
                        items?.filter((i) => i.modifierGroups?.includes(group.id)).length ?? 0;
                      return (
                        <TableRow key={group.id}>
                          <TableCell className="font-mono text-sm">{group.id}</TableCell>
                          <TableCell className="font-medium">{group.name}</TableCell>
                          <TableCell>
                            <Badge variant={group.required ? "destructive" : "secondary"}>
                              {group.required ? "Required" : "Optional"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{group.modifiers.length}</TableCell>
                          <TableCell className="text-right">{usedByCount} items</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  ...
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingModifierGroup(group);
                                    setModifierGroupDialogOpen(true);
                                  }}
                                >
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteModifierGroup(group)}
                                  className="text-destructive"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-2">No modifier groups found</p>
                  <Button
                    onClick={() => {
                      setEditingModifierGroup(null);
                      setModifierGroupDialogOpen(true);
                    }}
                  >
                    Add Your First Modifier Group
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ItemFormDialog
        open={itemDialogOpen}
        onClose={() => {
          setItemDialogOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSaveItem}
        item={editingItem}
        categories={categories}
        modifierGroups={modifierGroups}
        loading={createItem.isPending || updateItem.isPending}
      />

      <CategoryFormDialog
        open={categoryDialogOpen}
        onClose={() => {
          setCategoryDialogOpen(false);
          setEditingCategory(null);
        }}
        onSave={handleSaveCategory}
        category={editingCategory}
        loading={createCategory.isPending || renameCategory.isPending}
      />

      <ModifierGroupFormDialog
        open={modifierGroupDialogOpen}
        onClose={() => {
          setModifierGroupDialogOpen(false);
          setEditingModifierGroup(null);
        }}
        onSave={handleSaveModifierGroup}
        group={editingModifierGroup}
        loading={createModifierGroup.isPending || updateModifierGroup.isPending}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText="Delete"
        variant="destructive"
        loading={deleteItem.isPending || deleteCategory.isPending || deleteModifierGroup.isPending}
      />
    </div>
  );
}

export default MenuPage;
