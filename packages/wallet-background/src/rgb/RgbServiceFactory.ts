import { RgbService, type RgbServiceDependencies } from '@unisat/rgb-service'

/** The single construction point for local RGB protocol services. */
export function createRgbService(dependencies: RgbServiceDependencies): RgbService {
  return new RgbService(dependencies)
}
