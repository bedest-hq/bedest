import { TbExample } from "../tables/TbExample";
import { ServiceBase } from "../../base/services/ServiceBase";

class ServiceExample extends ServiceBase<typeof TbExample, string> {
  constructor() {
    super(TbExample);
  }
}

export default new ServiceExample();
