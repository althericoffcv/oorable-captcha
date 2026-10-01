export interface RenderedImage {
  contentType: string;
  data: Buffer;
}

export interface TextRendererProvider {
  render(code: string, options: { width?: number; height?: number; locale?: string }): Promise<RenderedImage>;
}
