import RedisManager from "@/infrastructure/redis/RedisManager";

class ServiceSystem {
  private isMaintenanceMode: boolean = false;
  private readonly MAINTENANCE_KEY = "system:maintenance_mode";

  async getMaintenance(): Promise<boolean> {
    if (RedisManager.isAvailable()) {
      try {
        const val = await RedisManager.get(this.MAINTENANCE_KEY);
        if (val !== null) {
          return val === "true" || val === "1";
        }
      } catch {
        // Fallback to local memory
      }
    }
    return this.isMaintenanceMode;
  }

  async setMaintenance(status: boolean): Promise<void> {
    this.isMaintenanceMode = status;
    if (RedisManager.isAvailable()) {
      try {
        await RedisManager.set(this.MAINTENANCE_KEY, status ? "true" : "false");
      } catch {
        // Fallback to local memory
      }
    }
  }
}

export default new ServiceSystem();
