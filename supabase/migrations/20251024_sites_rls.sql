-- Enable RLS on sites table
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users to select their own sites
CREATE POLICY "Users can view their own sites" ON public.sites
  FOR SELECT USING (auth.uid() = user_id);

-- Policy for authenticated users to insert their own sites
CREATE POLICY "Users can insert their own sites" ON public.sites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy for authenticated users to update their own sites
CREATE POLICY "Users can update their own sites" ON public.sites
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy for authenticated users to delete their own sites
CREATE POLICY "Users can delete their own sites" ON public.sites
  FOR DELETE USING (auth.uid() = user_id);
