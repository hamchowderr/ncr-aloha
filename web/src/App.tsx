import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MenuItemCard } from "@/components/MenuItemCard";
import { ItemConfigDialog } from "@/components/ItemConfigDialog";
import { Cart } from "@/components/Cart";
import { CallsPage } from "@/components/CallsPage";
import { VoiceChat } from "@/components/VoiceChat";
import { useMenu } from "@/hooks/useMenu";
import { useCart } from "@/hooks/useCart";
import type { MenuItem } from "@/types/menu";

type Page = "menu" | "calls";

function App() {
  const { menu, loading, error } = useMenu();
  const cart = useCart();
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<Page>("menu");

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
          <nav className="flex gap-2">
            <Button
              variant={currentPage === "menu" ? "secondary" : "ghost"}
              onClick={() => setCurrentPage("menu")}
              className={currentPage !== "menu" ? "text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20" : ""}
            >
              Menu
            </Button>
            <Button
              variant={currentPage === "calls" ? "secondary" : "ghost"}
              onClick={() => setCurrentPage("calls")}
              className={currentPage !== "calls" ? "text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20" : ""}
            >
              Voice Calls
            </Button>
          </nav>
        </div>
      </header>

      {/* Page Content */}
      {currentPage === "calls" ? (
        <CallsPage />
      ) : (
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
      )}

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

      {/* Voice Chat Button */}
      <VoiceChat />
    </div>
  );
}

export default App;
