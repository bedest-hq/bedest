import { SExample } from "../schemas/SExample";
import { ServiceBase } from "../../../common/services/ServiceBase";

class ServiceExample extends ServiceBase<typeof SExample, string> {
  constructor() {
    super(SExample);
  }
}

export default new ServiceExample();
