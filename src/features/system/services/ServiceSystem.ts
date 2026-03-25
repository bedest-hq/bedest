class ServiceSystem {
  private isMaintenanceMode: boolean = false;

  getMaintenance() {
    return this.isMaintenanceMode;
  }

  setMaintenance(status: boolean) {
    this.isMaintenanceMode = status;
  }
}

export default new ServiceSystem();
