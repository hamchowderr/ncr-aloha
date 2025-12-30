import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  menuApi,
  type Menu,
  type MenuItem,
  type CreateMenuItem,
  type CreateModifierGroup,
} from "@/lib/api";

export function useAdminMenu() {
  const { data: menu, isLoading: loading, error, refetch } = useQuery<Menu, Error>({
    queryKey: ["admin-menu"],
    queryFn: menuApi.getMenu,
  });

  // Transform menu items for admin display
  const items: MenuItem[] | null = menu?.items ?? null;

  return {
    items,
    menu,
    loading,
    error: error?.message ?? null,
    refetch,
  };
}

export function useAdminMenuItem(itemId: string | null) {
  const { data: menu } = useQuery<Menu, Error>({
    queryKey: ["admin-menu"],
    queryFn: menuApi.getMenu,
  });

  const item = itemId ? menu?.items.find((i) => i.id === itemId) ?? null : null;

  return { item };
}

/**
 * Hook for menu item mutations (create, update, delete)
 */
export function useMenuItemMutations() {
  const queryClient = useQueryClient();

  const invalidateMenu = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
  };

  const createItem = useMutation({
    mutationFn: (item: CreateMenuItem) => menuApi.createItem(item),
    onSuccess: invalidateMenu,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Partial<CreateMenuItem> }) =>
      menuApi.updateItem(itemId, data),
    onSuccess: invalidateMenu,
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => menuApi.deleteItem(itemId),
    onSuccess: invalidateMenu,
  });

  const toggleAvailability = useMutation({
    mutationFn: ({ itemId, available }: { itemId: string; available: boolean }) =>
      menuApi.toggleAvailability(itemId, available),
    onSuccess: invalidateMenu,
  });

  return {
    createItem,
    updateItem,
    deleteItem,
    toggleAvailability,
  };
}

/**
 * Hook for category mutations (create, rename, delete)
 */
export function useCategoryMutations() {
  const queryClient = useQueryClient();

  const invalidateMenu = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
  };

  const createCategory = useMutation({
    mutationFn: (name: string) => menuApi.createCategory(name),
    onSuccess: invalidateMenu,
  });

  const renameCategory = useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      menuApi.renameCategory(oldName, newName),
    onSuccess: invalidateMenu,
  });

  const deleteCategory = useMutation({
    mutationFn: (name: string) => menuApi.deleteCategory(name),
    onSuccess: invalidateMenu,
  });

  return {
    createCategory,
    renameCategory,
    deleteCategory,
  };
}

/**
 * Hook for modifier group mutations (create, update, delete)
 */
export function useModifierGroupMutations() {
  const queryClient = useQueryClient();

  const invalidateMenu = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
  };

  const createModifierGroup = useMutation({
    mutationFn: (group: CreateModifierGroup) => menuApi.createModifierGroup(group),
    onSuccess: invalidateMenu,
  });

  const updateModifierGroup = useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<CreateModifierGroup> }) =>
      menuApi.updateModifierGroup(groupId, data),
    onSuccess: invalidateMenu,
  });

  const deleteModifierGroup = useMutation({
    mutationFn: (groupId: string) => menuApi.deleteModifierGroup(groupId),
    onSuccess: invalidateMenu,
  });

  return {
    createModifierGroup,
    updateModifierGroup,
    deleteModifierGroup,
  };
}
