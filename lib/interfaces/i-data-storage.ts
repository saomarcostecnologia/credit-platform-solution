export interface IDataReader {
    readItem(id: string): Promise<any>;
    query(params: any): Promise<any[]>;
  }
  
  export interface IDataWriter {
    writeItem(item: any): Promise<void>;
    updateItem(id: string, item: any): Promise<void>;
    deleteItem(id: string): Promise<void>;
  }
  
  export interface IDataStorage extends IDataReader, IDataWriter {
    getMetrics(): Promise<any>;
  }