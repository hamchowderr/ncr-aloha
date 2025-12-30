import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MenuItemCard } from "@/components/MenuItemCard";
import { ItemConfigDialog } from "@/components/ItemConfigDialog";
import { Cart } from "@/components/Cart";
import { useMenu } from "@/hooks/useMenu";
import { useCart } from "@/hooks/useCart";
import type { MenuItem } from "@/types/menu";

function App() {
  const { menu, loading, error } = useMenu();
  const cart = useCart();
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading menu...</div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-destructive">
          Error loading menu: {error || "No menu data"}
        </div>
      </div>
    );
  }

  const currentCategory = activeCategory || menu.categories[0];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground py-4 px-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{menu.restaurant}</h1>
            <p className="text-primary-foreground/80">Voice Order Demo</p>
          </div>
          <nav className="flex gap-2 items-center">
            <a href="/admin">
              <Button
                variant="ghost"
                className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20"
              >
                Admin
              </Button>
            </a>
            <a
              href="https://github.com/hamchowderr/ncr-aloha"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </Button>
            </a>
          </nav>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-7xl mx-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Menu Section */}
            <div className="lg:col-span-2">
              <Tabs
                value={currentCategory}
                onValueChange={setActiveCategory}
                className="w-full"
              >
                <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
                  {menu.categories.map((category) => (
                    <TabsTrigger
                      key={category}
                      value={category}
                      className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      {category}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {menu.categories.map((category) => (
                  <TabsContent key={category} value={category} className="mt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {menu.items
                        .filter((item) => item.category === category && item.available)
                        .map((item) => (
                          <MenuItemCard
                            key={item.id}
                            item={item}
                            onClick={() => setSelectedItem(item)}
                          />
                        ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            {/* Cart Section */}
            <div className="lg:col-span-1">
              <div className="sticky top-4">
                <Cart
                  items={cart.items}
                  subtotal={cart.subtotal}
                  tax={cart.tax}
                  total={cart.total}
                  onRemove={cart.removeItem}
                  onClear={cart.clearCart}
                />
              </div>
            </div>
          </div>
      </main>

      {/* Item Config Dialog */}
      <ItemConfigDialog
        item={selectedItem}
        modifierGroups={menu.modifierGroups}
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        onAdd={(item, size, modifiers, quantity) => {
          cart.addItem(item, size, modifiers, quantity);
        }}
      />
    </div>
  );
}

export default App;
