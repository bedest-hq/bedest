import { ServiceBase } from "../../base/services/ServiceBase";
import { TbTenant } from "../tables/TbTenant";

class ServiceTenant extends ServiceBase<typeof TbTenant, string> {
  constructor() {
    super(TbTenant);
  }
}

export default new ServiceTenant();
