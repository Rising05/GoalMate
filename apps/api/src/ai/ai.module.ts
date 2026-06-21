import { Global, Module } from "@nestjs/common";
import { AiCallService } from "./ai-call.service";

@Global()
@Module({ providers: [AiCallService], exports: [AiCallService] })
export class AiModule {}
