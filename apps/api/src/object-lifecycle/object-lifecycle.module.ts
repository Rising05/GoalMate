import { Global, Module } from "@nestjs/common";
import { ObjectDeletionService } from "./object-deletion.service";

@Global()
@Module({ providers: [ObjectDeletionService], exports: [ObjectDeletionService] })
export class ObjectLifecycleModule {}
