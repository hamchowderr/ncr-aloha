import { useSites } from "@/hooks/useSites";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function SitesPage() {
  const { sites, loading, error } = useSites();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Sites</h1>

      <Card>
        <CardHeader>
          <CardTitle>Restaurant Locations</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive mb-2">Failed to load sites</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : sites && sites.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site Name</TableHead>
                  <TableHead>Enterprise Unit ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Timezone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">
                      {site.siteName}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {site.enterpriseUnitId}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          site.status === "ACTIVE" ? "default" : "secondary"
                        }
                      >
                        {site.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {site.address ? (
                        <span className="text-sm">
                          {[
                            site.address.line1,
                            site.address.city,
                            site.address.state,
                            site.address.postalCode,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {site.timezone || (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-2">No sites found</p>
              <p className="text-sm text-muted-foreground">
                Configure your NCR BSP credentials to fetch sites
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SitesPage;
