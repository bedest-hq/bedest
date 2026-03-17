import { ServiceBase } from "../../../common/services/ServiceBase";
import { STenant } from "../schemas/STenant";

class ServiceTenant extends ServiceBase<typeof STenant, string> {
  constructor() {
    super(STenant);
  }
}

export default new ServiceTenant();
