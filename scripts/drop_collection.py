from pymilvus import connections, utility

def drop_old_collection():
    try:
        connections.connect("default", host="localhost", port="19530")
        collection_name = "course_knowledge"
        if utility.has_collection(collection_name):
            utility.drop_collection(collection_name)
            print(f"✅ Collection '{collection_name}' dropped successfully.")
        else:
            print(f"ℹ️ Collection '{collection_name}' does not exist.")
    except Exception as e:
        print(f"❌ Error dropping collection: {e}")

if __name__ == "__main__":
    drop_old_collection()
