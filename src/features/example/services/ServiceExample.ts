import { SExample } from "../schemas/SExample";
import { ServiceBaseTenant } from "@/common/services/ServiceBaseTenant";

class ServiceExample extends ServiceBaseTenant<typeof SExample, string> {
  constructor() {
    super(SExample);
  }
}

export default new ServiceExample();
